"""
Key pool management for API providers.

Extracted from stages.py — shared utility for rate-limited,
circuit-breakered key rotation across all providers.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

# ============================================================================
# Rate Limit Constants
# ============================================================================

RATE_LIMIT_WINDOW_MS = 60_000
MAX_REQUESTS_PER_WINDOW = 30
CIRCUIT_BREAKER_THRESHOLD = 5
CIRCUIT_BASE_BACKOFF = 15_000
CIRCUIT_MAX_BACKOFF = 300_000
KEY_AUTO_RECOVER_MS = 120_000
HALF_OPEN_MAX_REQUESTS = 2


# ============================================================================
# Key Pool Data Structures
# ============================================================================

@dataclass
class KeyStats:
    total_requests: int = 0
    success_count: int = 0
    fail_count: int = 0
    last_fail_time: float = 0.0
    last_fail_type: str = ""
    consecutive_fails: int = 0
    recent_timestamps: list[float] = field(default_factory=list)


@dataclass
class KeyState:
    key: str
    last_used: float = 0.0
    cooldown_ms: int = 30_000
    max_concurrent: int = 3
    in_use: int = 0
    circuit_state: str = "closed"  # "closed" | "open" | "half-open"
    circuit_opened_at: float = 0.0
    circuit_retry_after: int = 0
    stats: KeyStats = field(default_factory=KeyStats)
    waiters: list[asyncio.Event] = field(default_factory=list)

    def _lock(self) -> asyncio.Lock:
        """Per-key lock for thread-safe operations."""
        if not hasattr(self, "_lk"):
            object.__setattr__(self, "_lk", asyncio.Lock())
        return object.__getattribute__(self, "_lk")


@dataclass
class KeyPool:
    provider: str  # "yunwu" | "grsai" | "mimo"
    keys: list[KeyState] = field(default_factory=list)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)


# ============================================================================
# Global Pools
# ============================================================================

_mimo_pool = KeyPool(provider="mimo")
_yunwu_pool = KeyPool(provider="yunwu")
_grsai_pool = KeyPool(provider="grsai")


def _pool_for(provider: str) -> KeyPool:
    if provider == "yunwu":
        return _yunwu_pool
    elif provider == "grsai":
        return _grsai_pool
    elif provider == "mimo":
        return _mimo_pool
    raise ValueError(f"Unknown provider: {provider}")


# ============================================================================
# Pool Operations
# ============================================================================

def merge_pool(
    pool: KeyPool,
    new_keys: list[str],
    cooldown_ms: int,
    max_concurrent: int,
    now: float,
) -> None:
    """Merge new keys into an existing pool, adding missing and removing stale."""
    new_key_set = set(new_keys)
    pool.keys = [k for k in pool.keys if k.key in new_key_set]

    for key_val in new_keys:
        if not any(k.key == key_val for k in pool.keys):
            pool.keys.append(KeyState(
                key=key_val,
                cooldown_ms=cooldown_ms,
                max_concurrent=max_concurrent,
            ))

    # Auto-recover stale failure state
    for sk in pool.keys:
        if sk.circuit_state == "open" and (now * 1000 - sk.circuit_opened_at * 1000) > sk.circuit_retry_after:
            sk.circuit_state = "half-open"
        if sk.circuit_state != "open" and sk.stats.consecutive_fails > 0 and (now * 1000 - sk.stats.last_fail_time * 1000) > KEY_AUTO_RECOVER_MS:
            sk.circuit_state = "closed"
            sk.stats.consecutive_fails = 0
        # Clean stale timestamps
        cutoff = now - RATE_LIMIT_WINDOW_MS / 1000.0
        sk.stats.recent_timestamps = [t for t in sk.stats.recent_timestamps if t > cutoff]


def sync_key_pools(
    mimo_keys: list[str],
    yunwu_keys: list[str],
    grsai_keys: list[str],
    yunwu_max_concurrent: int = 3,
    grsai_max_concurrent: int = 1,
) -> None:
    """Sync all key pools from configuration."""
    now = time.time()

    # MiMo pool (4 keys, prefer last 3, fallback to 1st)
    merge_pool(_mimo_pool, mimo_keys, 30_000, 3, now)

    # Yunwu pool
    yw_keys = [k for k in yunwu_keys if k.strip()]
    merge_pool(_yunwu_pool, yw_keys, 30_000, yunwu_max_concurrent, now)

    # Grsai pool
    gr_keys = [k for k in grsai_keys if k.strip()]
    merge_pool(_grsai_pool, gr_keys, 2_000, grsai_max_concurrent, now)


def get_pool_capacity(provider: str, yunwu_max_concurrent: int = 3, grsai_max_concurrent: int = 1) -> int:
    """Get max theoretical concurrency for a provider."""
    pool = _pool_for(provider)
    max_per_key = yunwu_max_concurrent if provider == "yunwu" else grsai_max_concurrent
    if provider == "mimo":
        max_per_key = 3
    available = [k for k in pool.keys if k.circuit_state != "open" and k.key.strip()]
    return len(available) * max_per_key


# Transient error patterns — these do NOT count as key failures (matches frontend logic)
TRANSIENT_ERROR_PATTERNS = [
    "excessive system load", "excessive", "high load", "负载已饱和",
    "负载过高", "rate limit", "too many requests", "429", "503",
    "上游负载", "无可用的 distributor", "timeout", "timed out",
]


def is_transient_error(error_msg: str) -> bool:
    """Check if an error is transient (load-based, rate-limit) — should not penalize the key."""
    if not error_msg:
        return False
    msg_lower = error_msg.lower()
    return any(pattern.lower() in msg_lower for pattern in TRANSIENT_ERROR_PATTERNS)


def get_total_capacity(yunwu_max_concurrent: int = 3, grsai_max_concurrent: int = 1) -> int:
    """Get total capacity across Yunwu + Grsai."""
    return (
        get_pool_capacity("yunwu", yunwu_max_concurrent, grsai_max_concurrent)
        + get_pool_capacity("grsai", yunwu_max_concurrent, grsai_max_concurrent)
    )


def available_key_count(provider: str) -> int:
    """Count available (non-open-circuit) keys."""
    pool = _pool_for(provider)
    return len([k for k in pool.keys if k.circuit_state != "open" and k.key.strip()])


def acquire_key(pool: KeyPool) -> str:
    """Acquire an available key from the pool. Picks the least-recently-used
    key that is not in open circuit state and has capacity."""
    import random
    available = [
        k for k in pool.keys
        if k.circuit_state != "open" and k.key.strip() and k.in_use < k.max_concurrent
    ]
    if not available:
        # Fallback: pick any non-open key even if at capacity
        available = [k for k in pool.keys if k.circuit_state != "open" and k.key.strip()]
    if not available:
        raise RuntimeError(f"No available keys for provider '{pool.provider}'")
    # Prefer half-open keys for testing, then least-recently-used
    half_open = [k for k in available if k.circuit_state == "half-open"]
    if half_open:
        chosen = half_open[0]
    else:
        # Sort by last_used (oldest first) with some randomization
        available.sort(key=lambda k: k.last_used)
        top = available[:min(3, len(available))]
        chosen = random.choice(top)
    chosen.in_use += 1
    chosen.last_used = time.time()
    return chosen.key


def release_key(pool: KeyPool, key: str, success: bool, transient: bool = False) -> None:
    """Release a key after use. Update circuit breaker state on failure.

    Args:
        pool: KeyPool to release the key to
        key: The API key string
        success: Whether the operation succeeded
        transient: If True, failure is considered transient (e.g. load-based)
                   and does NOT count toward circuit breaker threshold.
    """
    for ks in pool.keys:
        if ks.key == key:
            ks.in_use = max(0, ks.in_use - 1)
            if success:
                ks.stats.success_count += 1
                ks.stats.consecutive_fails = 0
                if ks.circuit_state == "half-open":
                    ks.circuit_state = "closed"
            elif not transient:
                ks.stats.fail_count += 1
                ks.stats.consecutive_fails += 1
                ks.stats.last_fail_time = time.time()
                if ks.stats.consecutive_fails >= CIRCUIT_BREAKER_THRESHOLD:
                    ks.circuit_state = "open"
                    ks.circuit_opened_at = time.time()
                    backoff = min(
                        CIRCUIT_BASE_BACKOFF * (2 ** (ks.stats.consecutive_fails - CIRCUIT_BREAKER_THRESHOLD)),
                        CIRCUIT_MAX_BACKOFF,
                    )
                    ks.circuit_retry_after = int(backoff)
            break
