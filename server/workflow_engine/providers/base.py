"""
Abstract base class for image generation providers.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ProviderResult:
    """Standardized result from any provider."""
    success: bool
    urls: list[str] = field(default_factory=list)
    error: str = ""
    metadata: dict = field(default_factory=dict)


class BaseProvider(ABC):
    """Abstract base for all image generation providers."""
    name: str = "base"

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        ref_image_url: str = None,
        ratio: str = "square",
        resolution: str = "2k",
        **kwargs: Any,
    ) -> ProviderResult:
        """Generate one or more images from a prompt and optional reference."""
        ...

    async def health_check(self) -> bool:
        """Check if the provider is reachable."""
        return True
