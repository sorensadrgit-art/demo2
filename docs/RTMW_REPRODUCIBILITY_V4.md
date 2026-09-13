# RTMW Reproducibility (V4)

## Result

A fresh virtualenv built **only** from
`services/biomechanics/runtime/requirements-rtmw.txt` plus the in-repo
vendored stub `services/biomechanics/runtime/rtmw_compat/mmdet`
reproduces the RTMW runtime: `mmpose.apis` imports, the
`rtmw-l 256x192 (cocktail14)` checkpoint loads, and `inference_topdown`
returns 133 whole-body keypoints. No real `mmdet`, no `mim`, no
post-install source patch, no `PYTHONPATH`.

## Why no real mmdet

`mmpose 1.3.2`'s model-registry import chain pulls
`models/heads/hybrid_heads/rtmo_head.py`, which does
`from mmdet.utils import ConfigType, reduce_mean` at module scope -- even
when only the top-down RTMW path is used and no detector is ever built.
The official releases are mutually exclusive with our pinned `mmcv 2.2.0`:

| mmdet | allows mmcv | with mmcv 2.2.0 |
|---|---|---|
| 3.1.0 (PyPI wheel) | `>=2.0.0rc4, <2.1.0` | `AssertionError` at import |
| 3.3.0 (PyPI wheel) | `>=2.0.0rc4, <2.2.0` | `AssertionError` at import |

(The V3 venv carried a hand-edited `mmdet/__init__.py` with the ceiling
raised to `<2.3.0`. That edit lived only inside the venv directory, so any
fresh provision lost it -- the exact non-reproducibility V4 eliminates.)

## What the stub is

`services/biomechanics/runtime/rtmw_compat/mmdet/` re-implements exactly
the two names mmpose touches, with upstream-identical semantics verified
against the official mmdet 3.3.0 sources:

- `ConfigType = Union[ConfigDict, dict]`
  (upstream `mmdet/utils/typing_utils.py`).
- `reduce_mean(tensor)`: distributed all-reduce mean; identity when
  distributed is unavailable/uninitialized
  (upstream `mmdet/utils/dist_utils.py`; the single-process inference
  path always takes the identity branch).

Any other `mmdet.*` access raises `AttributeError` with a
`KINELAB_MMDET_SHIM` prefix pointing at the provisioner, so detector
behavior can never be silently faked. The stub is exposed through a
`kinelab_rtmw_compat.pth` file written by the provisioner (no `PYTHONPATH`
needed at runtime).

## Provision

```bash
bash services/biomechanics/scripts/provision_rtmw.sh [--venv DIR] [--recreate]
bash services/biomechanics/scripts/rtmw_supervise.sh [--port 8102] [--no-start]
```

## Lockfile pins

`services/biomechanics/runtime/requirements-rtmw.txt` pins the full
verified matrix (torch 2.4.1+cpu, torchvision 0.19.1+cpu, mmcv 2.2.0,
mmengine 0.10.7, mmpose 1.3.2, numpy 1.26.4, opencv 4.11.0.86, plus the
transitive wheels `mim` would otherwise resolve at install time).
`mim`/real-`mmdet` are intentionally absent. The provisioner refuses to
finish if a real `mmdet` leaks into the venv.

## Verified (2026-09-13)

Clean venv at `/tmp/rtmw_clean/clean-rtmw` (Python 3.11.15), built from the
lockfile alone: `mmpose.apis` import OK, checkpoint
`models/rtmw/rtmw-l_256x192.pth` loads on CPU, `inference_topdown` on a
blank frame returns keypoints of shape `(1, 133, 2)`. Same checks pass in
the in-repo venv after real-mmdet removal.
