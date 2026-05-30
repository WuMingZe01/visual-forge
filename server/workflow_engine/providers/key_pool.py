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
