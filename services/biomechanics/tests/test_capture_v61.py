"""V6.1 capture bridge tests (Phases 34-35).

Bundle mechanics are tested with the deterministic INGEST FIXTURE
(synthetic stick renders — file packaging, timestamps, checksums,
ingest only). This is an engineering integration test, NOT physical
validation. V5/V5.5/V5.6 science fixtures are untouched (Phase 22).

Required mapping:
  test_capture_bundle_valid               valid fixture imports, precision
  test_capture_checksum_failure           CAPTURE_CHECKSUM_MISMATCH
  test_capture_missing_camera             CAPTURE_CAMERA_MISSING
  test_capture_timestamp_count_mismatch   CAPTURE_TIMESTAMP_MISMATCH
  test_capture_unsynchronized_rejected    CAPTURE_NOT_SYNCHRONIZED
  test_capture_calibration_mismatch       CAPTURE_CALIBRATION_MISMATCH
  test_capture_precision_requires_three_views  grade + process_capture gate
  test_capture_clinical_two_views         2-cam bundle -> clinical, no precision
  test_capture_frame_decode               deterministic decode
  test_capture_synchronized_frame_sets    comb recorded, order-aligned
  test_capture_camera_subset              subset reprocessing
  test_capture_downsample                 deterministic decimation
  test_capture_provenance                 physical provenance links
  test_process_capture_uses_precision_v56 pipeline wiring (mocked RTMW/IK)
  test_capture_bundle_to_clinical_measurement  e2e bundle -> measurement
"""
from __future__ import annotations

import json
import os
import shutil
import sys

import pytest

SVC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FIX_DIR = os.path.join(SVC, "tests", "capture_fixtures")
for _p in (SVC, FIX_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from app.api.capture_v61 import _select_frames, validate_bundle
from app.capture.bundle import decode_frame_bgr
from app.main import app
from build_ingest_fixture import INGEST_FIXTURE_TAG, build
from fastapi.testclient import TestClient

TAG = INGEST_FIXTURE_TAG


@pytest.fixture(scope="module")
def bundle_dir(tmp_path_factory):
    out = tmp_path_factory.mktemp("ingest")
    return build(out)


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_capture_bundle_valid(bundle_dir, client):
    r = client.post("/capture/import",
                    json={"bundlePath": str(bundle_dir)})
    body = r.json()
    assert body["validationStatus"] == "VALID"
    assert body["cameraCount"] == 3
    assert body["syncStatus"] == "SYNCHRONIZED"
    assert body["calibrationStatus"] == "COMPATIBLE"
    assert body["acquisitionGrade"] == "precision"
    assert body["readyForPrecision"] is True
    assert TAG in json.loads(
        (bundle_dir / "manifest.json").read_text())["fixtureTag"]


def test_capture_checksum_failure(bundle_dir, client, tmp_path):
    bad = tmp_path / "bad-checksum"
    shutil.copytree(bundle_dir, bad)
    (bad / "manifest.json").write_text(
        (bad / "manifest.json").read_text().replace("ingest-fixture-0001",
                                                    "ingest-fixture-0002"))
    r = client.post("/capture/import", json={"bundlePath": str(bad)})
    assert r.json()["error"]["code"] == "CAPTURE_CHECKSUM_MISMATCH"


def test_capture_missing_camera(bundle_dir, client, tmp_path):
    bad = tmp_path / "missing-cam"
    shutil.copytree(bundle_dir, bad)
    shutil.rmtree(bad / "cameras" / "cam-03")
    # rehash so the failure is the missing camera, not the checksum
    from app.capture.bundle import hash_bundle_files, render_sha256sums
    (bad / "SHA256SUMS.txt").write_text(
        render_sha256sums(hash_bundle_files(bad)))
    r = client.post("/capture/import", json={"bundlePath": str(bad)})
    assert r.json()["error"]["code"] == "CAPTURE_CAMERA_MISSING"


def test_capture_timestamp_count_mismatch(bundle_dir, client, tmp_path):
    bad = tmp_path / "ts-mismatch"
    shutil.copytree(bundle_dir, bad)
    ts = bad / "cameras" / "cam-01" / "timestamps.csv"
    lines = ts.read_text().splitlines()
    ts.write_text("\n".join(lines[:-1]) + "\n")  # drop one timestamp
    from app.capture.bundle import hash_bundle_files, render_sha256sums
    (bad / "SHA256SUMS.txt").write_text(
        render_sha256sums(hash_bundle_files(bad)))
    r = client.post("/capture/import", json={"bundlePath": str(bad)})
    assert r.json()["error"]["code"] == "CAPTURE_TIMESTAMP_MISMATCH"


def test_capture_unsynchronized_rejected(bundle_dir, client, tmp_path):
    bad = tmp_path / "unsync"
    shutil.copytree(bundle_dir, bad)
    man = json.loads((bad / "manifest.json").read_text())
    man["synchronizationMethod"] = "UNSYNCHRONIZED"
    (bad / "manifest.json").write_text(json.dumps(man, indent=2))
    from app.capture.bundle import hash_bundle_files, render_sha256sums
    (bad / "SHA256SUMS.txt").write_text(
        render_sha256sums(hash_bundle_files(bad)))
    r = client.post("/capture/import", json={"bundlePath": str(bad)})
    assert r.json()["error"]["code"] == "CAPTURE_NOT_SYNCHRONIZED"


def test_capture_calibration_mismatch(bundle_dir, client, tmp_path):
    bad = tmp_path / "cal-mismatch"
    shutil.copytree(bundle_dir, bad)
    cal = json.loads(
        (bad / "calibration" / "calibration.json").read_text())
    cal["calibrationId"] = "cal-someone-else"
    (bad / "calibration" / "calibration.json").write_text(
        json.dumps(cal, indent=2))
    from app.capture.bundle import hash_bundle_files, render_sha256sums
    (bad / "SHA256SUMS.txt").write_text(
        render_sha256sums(hash_bundle_files(bad)))
    r = client.post("/capture/import", json={"bundlePath": str(bad)})
    assert r.json()["error"]["code"] == "CAPTURE_CALIBRATION_MISMATCH"


def test_capture_precision_requires_three_views(bundle_dir, client,
                                                tmp_path):
    two = tmp_path / "two-cam"
    shutil.copytree(bundle_dir, two)
    man = json.loads((two / "manifest.json").read_text())
    man["cameras"] = [c for c in man["cameras"]
                      if c["cameraId"] != "cam-03"]
    man["cameraCount"] = 2
    (two / "manifest.json").write_text(json.dumps(man, indent=2))
    cal = json.loads((two / "calibration" / "calibration.json").read_text())
    cal["cameras"] = [c for c in cal["cameras"]
                      if c["cameraId"] != "cam-03"]
    (two / "calibration" / "calibration.json").write_text(
        json.dumps(cal, indent=2))
    shutil.rmtree(two / "cameras" / "cam-03")
    from app.capture.bundle import hash_bundle_files, render_sha256sums
    (two / "SHA256SUMS.txt").write_text(
        render_sha256sums(hash_bundle_files(two)))
    r = client.post("/capture/import", json={"bundlePath": str(two)})
    body = r.json()
    assert body["acquisitionGrade"] == "clinical"
    assert body["readyForPrecision"] is False
    r2 = client.post("/precision/process_capture",
                     json={"physicalSessionId": body["sessionId"]})
    assert r2.json()["error"]["code"] == "CAPTURE_TOO_FEW_CAMERAS"


def test_capture_clinical_two_views(bundle_dir, client, tmp_path):
    two = tmp_path / "two-cam-b"
    shutil.copytree(bundle_dir, two)
    man = json.loads((two / "manifest.json").read_text())
    man["cameras"] = [c for c in man["cameras"]
                      if c["cameraId"] != "cam-03"]
    man["cameraCount"] = 2
    (two / "manifest.json").write_text(json.dumps(man, indent=2))
    cal = json.loads((two / "calibration" / "calibration.json").read_text())
    cal["cameras"] = [c for c in cal["cameras"]
                      if c["cameraId"] != "cam-03"]
    (two / "calibration" / "calibration.json").write_text(
        json.dumps(cal, indent=2))
    shutil.rmtree(two / "cameras" / "cam-03")
    from app.capture.bundle import hash_bundle_files, render_sha256sums
    (two / "SHA256SUMS.txt").write_text(
        render_sha256sums(hash_bundle_files(two)))
    r = client.post("/capture/import",
                    json={"bundlePath": str(two),
                          "sessionId": "ingest-two-cam"})
    body = r.json()
    assert body["validationStatus"] == "VALID"
    assert body["acquisitionGrade"] == "clinical"


def test_capture_frame_decode(bundle_dir):
    from app.capture.bundle import camera_recording_path, count_frames
    rec = camera_recording_path(bundle_dir / "cameras" / "cam-01")
    assert count_frames(rec) == 6
    img0 = decode_frame_bgr(rec, 0)
    img0b = decode_frame_bgr(rec, 0)
    assert (img0 == img0b).all(), "decode must be deterministic"
    assert img0.shape == (240, 320, 3)
    img5 = decode_frame_bgr(rec, 5)
    assert not (img0 == img5).all(), "stick figure must move"


def test_capture_synchronized_frame_sets(bundle_dir, client):
    from app.api.capture_v61 import _SESSIONS, CaptureTrialWindow
    client.post("/capture/import", json={"bundlePath": str(bundle_dir)})
    session = _SESSIONS["ingest-fixture-0001"]
    plan = _select_frames(session, CaptureTrialWindow())
    assert len(plan["frameSets"]) == 6
    for s in plan["frameSets"]:
        assert s["combMs"] == 0.0
        assert sorted(s["members"]) == ["cam-01", "cam-02", "cam-03"]


def test_capture_camera_subset(bundle_dir, client):
    from app.api.capture_v61 import _SESSIONS, CaptureTrialWindow
    client.post("/capture/import", json={"bundlePath": str(bundle_dir)})
    session = _SESSIONS["ingest-fixture-0001"]
    plan = _select_frames(
        session, CaptureTrialWindow(cameraSubset=["cam-01", "cam-02"]))
    assert plan["cameras"] == ["cam-01", "cam-02"]
    assert len(plan["frameSets"]) == 6


def test_capture_downsample(bundle_dir, client):
    from app.api.capture_v61 import _SESSIONS, CaptureTrialWindow
    client.post("/capture/import", json={"bundlePath": str(bundle_dir)})
    session = _SESSIONS["ingest-fixture-0001"]
    plan = _select_frames(session, CaptureTrialWindow(downsampleFps=15.0))
    assert plan["stride"] == 2
    assert plan["effectiveHz"] == 15.0
    assert len(plan["frameSets"]) == 3


def _mocked_process(monkeypatch, client, bundle_dir, **window):
    """Import fixture + stub RTMW/IK -> run process_capture, return job."""
    client.post("/capture/import", json={"bundlePath": str(bundle_dir)})

    def fake_infer(_b64, camera_id=None, timestamp_ms=None, **kw):
        import numpy as np
        from build_ingest_fixture import _cam_pose, _stick_body
        idx = {"cam-01": 0, "cam-02": 1, "cam-03": 2}[camera_id]
        _R, _C, P = _cam_pose(idx)
        k = int((timestamp_ms or 0) // (1000 / 30)) % 6
        body = _stick_body(2 * np.pi * (k % 6) / 6)
        lms = []
        for name, pt in body.items():
            if name == "head":
                continue  # midline head is not an RTMW landmark id
            h = P @ np.append(pt, 1.0)
            x, y = float(h[0] / h[2]), float(h[1] / h[2])
            lms.append({"landmarkId": name, "xPx": x, "yPx": y,
                        "confidence": 0.95})
        return {"model": "rtmw-stub", "landmarks": lms}

    def fake_ik(_traj, _out, accuracy=1e-5):
        import os
        os.makedirs(_out, exist_ok=True)
        return {"model": "stub", "opensimVersion": "stub",
                "coordinatesDeg": {"knee_angle_r": [42.0]}}

    monkeypatch.setattr("app.api.capture_v61.rtmw_infer", fake_infer,
                        raising=False)
    # process_capture imports rtmw_infer locally; patch the worker instead
    monkeypatch.setattr("app.runtime_workers.rtmw_infer", fake_infer)
    monkeypatch.setattr("app.runtime_workers.opensim_ik", fake_ik)
    import app.api.capture_v61 as cap
    monkeypatch.setattr(cap, "rtmw_infer", fake_infer, raising=False)
    req = {"physicalSessionId": "ingest-fixture-0001",
           "raisedSide": {"joint": "wrist", "side": "right"}, **window}
    return client.post("/precision/process_capture", json=req).json()


def test_capture_provenance(bundle_dir, client, monkeypatch):
    job = _mocked_process(monkeypatch, client, bundle_dir)
    assert job["state"] == "COMPLETE", job.get("error")
    prov = job["measurement"]["provenance"]
    assert prov["captureOrigin"] == "REAL_PHYSICAL_CAPTURE"
    assert prov["physicalSessionId"] == "ingest-fixture-0001"
    assert set(prov["cameraSubset"]) == {"cam-01", "cam-02", "cam-03"}
    assert prov["calibrationId"] == "cal-ingest-fixture-01"
    assert prov["sourceRecordingHashes"]["cam-01"]
    assert prov["timestampFileHashes"]["cam-02"]
    assert prov["calibrationHash"] and prov["manifestHash"]
    assert prov["rtmwUsed"] and prov["identitySolverUsed"]
    assert prov["multiviewUsed"] and prov["opensimUsed"]
    assert prov["hiddenFallback"] is False
    assert prov["pipelineVersion"] == "kinelab-precision-v5.6"
    assert job["stages"]["physicalCapture"]["frameSets"] == 6


def test_process_capture_uses_precision_v56(bundle_dir, client, monkeypatch):
    job = _mocked_process(monkeypatch, client, bundle_dir)
    assert job["state"] == "COMPLETE", job.get("error")
    assert job["pipelineVersion"] == "kinelab-precision-v5.6"
    assert "identity" in job["stages"]
    assert job["stages"]["identity"]["solverVersion"]
    assert job["measurement"]["source"] == "biomechanical-model"


def test_capture_bundle_to_clinical_measurement(bundle_dir, client,
                                                monkeypatch):
    """E2E (engineering): bundle -> import -> frames -> V5.6 -> measurement.

    Uses the INGEST FIXTURE with stubbed RTMW/IK (bundle mechanics are
    real; pose pixels are projected fixture truth through the SAME
    calibration). NOT physical validation.
    """
    job = _mocked_process(monkeypatch, client, bundle_dir)
    assert job["state"] == "COMPLETE", job.get("error")
    m = job["measurement"]
    assert m["metric"] == "joint-angle"
    assert m["source"] == "biomechanical-model"
    assert abs(m["valueDeg"] - 42.0) < 1e-6
    assert m["provenance"]["physicalSessionId"] == "ingest-fixture-0001"


def test_validate_bundle_direct(bundle_dir):
    record = validate_bundle(bundle_dir)
    assert record["acquisitionGrade"] == "precision"
    assert record["precisionEligible"] is True
    assert record["syncCombMs"] == 0.0
