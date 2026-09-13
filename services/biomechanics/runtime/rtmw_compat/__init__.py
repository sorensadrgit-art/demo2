"""KineLab RTMW compatibility package.

The RTMW pose path (mmpose 1.3.2 + mmcv 2.2.0 + torch 2.4 CPU) needs exactly
two names from ``mmdet.utils`` at import time
(``ConfigType``, ``reduce_mean``), pulled in by mmpose's RTMO-head registry
module even though no detector is ever instantiated. No mutually compatible
official mmdet release exists for mmcv 2.2.0 (3.1.0 pins mmcv<2.1.0, 3.3.0
pins mmcv<2.2.0; both abort at import). This package vendors the two names
with identical semantics to upstream mmdet 3.3.0 (see mmdet/utils.py) so the
environment installs from this lockfile alone with zero post-install patch.
"""
