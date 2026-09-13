"""V5.5 perception-benchmark tests (P31/P32).

Offline, deterministic, no workers, no inference: provider interface +
selection, anatomical consistency layer, and benchmark artifact schema
guards. The V5 adversarial fixture (adversarial-triangulation style tests
in test_reconstruction.py) is untouched.
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.anatomy.consistency import (  # noqa: E402
    REFERENCE_SEGMENTS_M, anatomical_consistency)
from app.pose_providers import (  # noqa: E402
    DEFAULT_PROVIDER, PROVIDER_REGISTRY, BenchmarkPose, selected_provider_name)


def test_provider_registry_has_default():
    assert DEFAULT_PROVIDER in PROVIDER_REGISTRY
    assert PROVIDER_REGISTRY[DEFAULT_PROVIDER].startswith("providers_rtmw:")


def test_selected_provider_env_override(monkeypatch):
    monkeypatch.setenv("KINELAB_PRECISION_POSE_PROVIDER", "rtmw-l-384x288")
    assert selected_provider_name() == "rtmw-l-384x288"


def test_selected_provider_default(monkeypatch):
    monkeypatch.delenv("KINELAB_PRECISION_POSE_PROVIDER", raising=False)
    assert selected_provider_name() == DEFAULT_PROVIDER


def test_benchmark_pose_schema_fields():
    p = BenchmarkPose()
    for f in ("provider", "model", "inputResolution", "checkpoint",
              "checkpointSha256", "keypointSchema", "schemaVersion",
              "license", "device", "inferenceMs", "detectionPath"):
        assert hasattr(p, f), f


def test_anatomical_consistency_passes_fixture_pose():
    pts = {"right-hip": (0.0, 0.90, 0.0),
           "right-knee": (0.0, 0.90 - REFERENCE_SEGMENTS_M["femur"], 0.0),
           "right-ankle": (0.0, 0.90 - REFERENCE_SEGMENTS_M["femur"]
                           - REFERENCE_SEGMENTS_M["tibia"], 0.0),
           "left-hip": (0.20, 0.90, 0.0),
           "left-knee": (0.20, 0.90 - REFERENCE_SEGMENTS_M["femur"], 0.0),
           "left-ankle": (0.20, 0.90 - REFERENCE_SEGMENTS_M["femur"]
                          - REFERENCE_SEGMENTS_M["tibia"], 0.0)}
    out = anatomical_consistency(pts)
    assert out["pass"] is True
    assert out["rejections"] == []


def test_anatomical_consistency_rejects_collapsed_limbs():
    # both ankles collapsed to the same point: separation gate must fire
    # even though segment lengths are individually plausible.
    pts = {"right-hip": (0.0, 0.90, 0.0),
           "right-knee": (0.0, 0.50, 0.0),
           "right-ankle": (0.0, 0.07, 0.0),
           "left-hip": (0.20, 0.90, 0.0),
           "left-knee": (0.20, 0.50, 0.0),
           "left-ankle": (0.0, 0.07, 0.0)}
    out = anatomical_consistency(pts)
    assert out["pass"] is False
    assert any(r.startswith("collapse:") for r in out["rejections"])


def test_anatomical_consistency_rejects_wrong_segment():
    # ankle displaced 450mm (V5 60deg failure mode): tibia band must fire.
    pts = {"right-hip": (0.0, 0.90, 0.0),
           "right-knee": (0.0, 0.5042, 0.0),
           "right-ankle": (0.45, 0.07, 0.0),  # ~450mm lateral error
           "left-hip": (0.20, 0.90, 0.0),
           "left-knee": (0.20, 0.5042, 0.0),
           "left-ankle": (0.20, 0.0742, 0.0)}
    out = anatomical_consistency(pts)
    assert out["pass"] is False
    assert any(r.startswith("segment:tibia-r") for r in out["rejections"])


def test_anatomical_consistency_needs_no_truth():
    # layer consumes only the triangulated solution: no truth params exist.
    import inspect

    sig = inspect.signature(anatomical_consistency)
    assert "truth" not in sig.parameters
    assert "angle" not in sig.parameters


def test_v55_results_artifact_schema():
    here = os.path.dirname(os.path.abspath(__file__))  # .../services/biomechanics/tests
    repo = os.path.normpath(os.path.join(here, "..", "..", ".."))
    path = os.path.join(repo, "artifacts", "perception-v55-results.json")
    if not os.path.exists(path):
        import pytest
        pytest.skip("perception-v55-results.json not yet written")
    doc = json.load(open(path))
    assert doc["benchmark"] == "kinelab-perception-v5.5"
    for key in ("providerSelection", "viewpointMap", "resolutionComparison",
                "realImageProbe", "temporalRamp", "anatomicalConsistency",
                "syntheticVsRealGap", "decision"):
        assert key in doc, key
    assert doc["decision"]["provider"] in PROVIDER_REGISTRY
