"""Re-exports the vendored ``mmdet.utils`` names (upstream-identical)."""

from __future__ import annotations

from . import ConfigType, reduce_mean, utils  # noqa: F401

__all__ = ["ConfigType", "reduce_mean", "utils"]
