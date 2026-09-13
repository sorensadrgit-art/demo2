"""V4 determinism/reproducibility gate: RTMW stub semantics + lockfile hygiene.

Runs in the MAIN interpreter (no torch/mmpose needed): asserts the vendored
mmdet stub is upstream-identical (ConfigType alias, reduce_mean identity and
all-reduce branches) and that the lockfile+provisioner contain no banned
dependencies (real mmdet, mim) while pinning the verified matrix.
"""
from __future__ import annotations

import importlib.util
import os
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
COMPAT = os.path.join(REPO_ROOT, "services", "biomechanics", "runtime", "rtmw_compat")
STUB_INIT = os.path.join(COMPAT, "mmdet", "__init__.py")
LOCKFILE = os.path.join(REPO_ROOT, "services", "biomechanics", "runtime", "requirements-rtmw.txt")
PROVISIONER = os.path.join(REPO_ROOT, "services", "biomechanics", "scripts", "provision_rtmw.sh")


def _load_stub():
    if COMPAT not in sys.path:
        sys.path.insert(0, COMPAT)
    for mod in [m for m in list(sys.modules) if m == "mmdet" or m.startswith("mmdet.")]:
        del sys.modules[mod]
    spec = importlib.util.spec_from_file_location("mmdet", STUB_INIT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["mmdet"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_stub_configtype_matches_upstream():
    stub = _load_stub()
    alias = stub.utils.ConfigType
    assert "ConfigDict" in str(alias) and "dict" in str(alias)


def test_stub_reduce_mean_identity_single_process():
    stub = _load_stub()

    class T:
        def __init__(self, v):
            self.v = v

        def clone(self):
            raise AssertionError("clone() must not run when distributed is inactive")

    t = T(3.0)
    assert stub.utils.reduce_mean(t) is t


def test_stub_reduce_mean_allreduce_when_initialized(monkeypatch):
    stub = _load_stub()
    pytest.importorskip("torch.distributed")
    import torch.distributed as dist  # noqa: PLC0415

    class T:
        def __init__(self, v):
            self.v = v

        def clone(self):
            return T(self.v)

        def div_(self, n):
            self.v /= n
            return self

    seen = {}
    monkeypatch.setattr(dist, "is_available", lambda: True)
    monkeypatch.setattr(dist, "is_initialized", lambda: True)
    monkeypatch.setattr(dist, "get_world_size", lambda: 4)
    monkeypatch.setattr(dist, "all_reduce", lambda t: seen.setdefault("v", t.v))
    out = stub.utils.reduce_mean(T(8.0))
    assert out.v == pytest.approx(2.0) and seen["v"] == pytest.approx(2.0)


def test_stub_rejects_non_vendored_mmdet_surface():
    stub = _load_stub()
    with pytest.raises(AttributeError, match="KINELAB_MMDET_SHIM"):
        stub.Detector  # noqa: B018


def test_lockfile_pins_matrix_without_mmdet_or_mim():
    body = open(LOCKFILE).read()
    for pin in ["torch==2.4.1+cpu", "torchvision==0.19.1+cpu", "mmcv==2.2.0",
                "mmengine==0.10.7", "mmpose==1.3.2", "numpy==1.26.4"]:
        assert pin in body, pin
    for line in body.splitlines():
        s = line.strip()
        if not s or s.startswith(("#", "-")):
            continue
        name = s.split("=")[0].split()[0].lower()
        assert name not in {"mmdet", "mim", "openmim"}, s


def test_provisioner_writes_pth_and_refuses_real_mmdet():
    body = open(PROVISIONER).read()
    assert "kinelab_rtmw_compat.pth" in body
    assert "import mmdet" in body and "exit 1" in body
    assert "mim install" not in body and "openmim" not in body
