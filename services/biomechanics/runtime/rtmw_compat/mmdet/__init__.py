"""Vendored ``mmdet`` import shim for the RTMW runtime.

Upstream ``mmdet`` aborts at import for our pinned mmcv (see package doc and
docs/RTMW_REPRODUCIBILITY_V4.md). Only ``mmdet.utils.ConfigType`` and
``mmdet.utils.reduce_mean`` are ever touched by mmpose 1.3.2's import chain
(``models/heads/hybrid_heads/rtmo_head.py`` -- a registry import; the RTMO
head itself is never built or run in the top-down RTMW path). Both are
re-implemented here with upstream-identical semantics:

- ``ConfigType``: ``Union[ConfigDict, dict]``
  (upstream: mmdet 3.3.0 ``utils/typing_utils.py``).
- ``reduce_mean``: all-reduce mean across GPUs, identity when distributed
  is unavailable/uninitialized (upstream: mmdet 3.3.0
  ``utils/dist_utils.py``).

Any other ``mmdet.*`` attribute access raises a typed error directing to the
provisioner instead of silently faking detector behavior.
"""

from __future__ import annotations

from typing import Union

try:
    from mmengine.config import ConfigDict
except ModuleNotFoundError:  # main-interp gate: alias target checked by name
    ConfigDict = None

__version__ = "0.0.0-kinelab-vendored"
__all__ = ["utils"]


class _Utils:
    ConfigType = Union[ConfigDict, dict] if ConfigDict is not None else "Union[ConfigDict, dict]"

    @staticmethod
    def reduce_mean(tensor):
        """Mean of tensor across GPUs; identity when distributed is inactive."""
        try:
            import torch.distributed as dist  # noqa: PLC0415
        except ModuleNotFoundError:  # main-interp gate: stub must stay importable
            return tensor

        if not (dist.is_available() and dist.is_initialized()):
            return tensor
        tensor = tensor.clone()
        dist.all_reduce(tensor.div_(dist.get_world_size()))
        return tensor


utils = _Utils()
ConfigType = _Utils.ConfigType
reduce_mean = _Utils.reduce_mean


def __getattr__(name: str):
    raise AttributeError(
        f"KINELAB_MMDET_SHIM: 'mmdet.{name}' is not vendored "
        "(only mmdet.utils.{ConfigType,reduce_mean} are provided). "
        "Run services/biomechanics/scripts/provision_rtmw.sh to provision the runtime."
    )
