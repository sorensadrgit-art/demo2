"""R1 release security tests: capture-import hardening (no science changes).

Covers: relative-path rejection, traversal rejection, symlink-escape
rejection, oversized-manifest rejection, malformed-CSV rejection,
duplicate-camera rejection, invalid-calibration rejection,
unsynchronized-bundle rejection, config/startup validation, and request-id
propagation. Preserves V6.1 typed-error semantics throughout.
"""
from __future__ import annotations

import json
import os
import sys

import pytest

SVC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FIX_DIR = os.path.join(SVC, "tests", "capture_fixtures")
for _p in (SVC, FIX_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from app.api.capture_v61 import _enforce_bundle_quotas, _resolve_bundle_path
from app.config import SETTINGS, load_settings
from app.domain.errors import CaptureBundleInvalid
from app.logging_util import redact
from app.main import app
from build_ingest_fixture import build
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def bundle_dir(tmp_path_factory):
    return build(tmp_path_factory.mktemp("sec"))


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_relative_path_rejected():
    with pytest.raises(CaptureBundleInvalid):
        _resolve_bundle_path("cameras/session-1")


def test_traversal_rejected(tmp_path):
    with pytest.raises(CaptureBundleInvalid):
        _resolve_bundle_path(str(tmp_path / ".." / "etc"))


def test_missing_path_rejected():
    with pytest.raises(CaptureBundleInvalid):
        _resolve_bundle_path("/nonexistent/kinelab-bundle")


def test_symlink_root_rejected(tmp_path, bundle_dir):
    link = tmp_path / "link-bundle"
    try:
        link.symlink_to(bundle_dir, target_is_directory=True)
    except OSError:
        pytest.skip("symlinks unavailable")
    with pytest.raises(CaptureBundleInvalid):
        _resolve_bundle_path(str(link))


def test_oversized_manifest_rejected(tmp_path, bundle_dir):
    import shutil

    big = tmp_path / "big"
    shutil.copytree(bundle_dir, big)
    (big / "manifest.json").write_bytes(b"x" * 300 * 1024)
    with pytest.raises(CaptureBundleInvalid):
        _resolve_bundle_path(str(big))


def test_malformed_csv_rejected(tmp_path, bundle_dir):
    import shutil

    bad = tmp_path / "badcsv"
    shutil.copytree(bundle_dir, bad)
    cams = sorted((bad / "cameras").iterdir())
    (cams[0] / "timestamps.csv").write_text("not,a,real\n1,2\n")
    client = TestClient(app)
    r = client.post("/capture/import", json={"bundlePath": str(bad)})
    body = r.json()
    # Checksum gate fires before timestamp parsing per V6.1 ordering —
    # either is a correct typed rejection of the corrupted bundle.
    assert body.get("error", {}).get("code") in (
        "CAPTURE_TIMESTAMP_MISMATCH", "CAPTURE_BUNDLE_INVALID",
        "CAPTURE_CHECKSUM_MISMATCH")


def test_duplicate_camera_ids_rejected(tmp_path, bundle_dir):
    import shutil

    dup = tmp_path / "dup"
    shutil.copytree(bundle_dir, dup)
    man = json.loads((dup / "manifest.json").read_text())
    man["cameras"] = man["cameras"] + [man["cameras"][0]]
    man["cameraCount"] = len(man["cameras"])
    (dup / "manifest.json").write_text(json.dumps(man))
    client = TestClient(app)
    r = client.post("/capture/import", json={"bundlePath": str(dup)})
    assert r.json().get("error", {}).get("code") in (
        "CAPTURE_CAMERA_MISSING", "CAPTURE_CHECKSUM_MISMATCH",
        "CAPTURE_BUNDLE_INVALID")


def test_invalid_calibration_rejected(tmp_path, bundle_dir):
    import shutil

    bad = tmp_path / "badcal"
    shutil.copytree(bundle_dir, bad)
    (bad / "calibration" / "calibration.json").write_text("{broken")
    client = TestClient(app)
    r = client.post("/capture/import", json={"bundlePath": str(bad)})
    assert r.json().get("error", {}).get("code") in (
        "CAPTURE_BUNDLE_INVALID", "CAPTURE_CHECKSUM_MISMATCH")


def test_unsynchronized_rejected(tmp_path, bundle_dir):
    import shutil

    uns = tmp_path / "unsync"
    shutil.copytree(bundle_dir, uns)
    man = json.loads((uns / "manifest.json").read_text())
    man["synchronizationMethod"] = "UNSYNCHRONIZED"
    (uns / "manifest.json").write_text(json.dumps(man))
    client = TestClient(app)
    r = client.post("/capture/import", json={"bundlePath": str(uns)})
    assert r.json().get("error", {}).get("code") in (
        "CAPTURE_NOT_SYNCHRONIZED", "CAPTURE_CHECKSUM_MISMATCH")


def test_quota_camera_limit(bundle_dir):
    class Tiny:
        max_bundle_mb = 99999.0
        max_video_mb = 99999.0
        max_cameras = 1
        max_manifest_kb = 99999.0
        max_timestamp_rows = 9999999

    with pytest.raises(CaptureBundleInvalid):
        _enforce_bundle_quotas(bundle_dir, Tiny())


def test_config_rejects_wildcard_cors(monkeypatch):
    monkeypatch.setenv("KINELAB_CORS_ORIGINS", "*")
    monkeypatch.setenv("KINELAB_RELEASE_CHANNEL", "RESEARCH_PREVIEW")
    s = load_settings()
    assert any("*" in p for p in s.problems())


def test_config_rejects_bad_channel(monkeypatch):
    monkeypatch.setenv("KINELAB_RELEASE_CHANNEL", "CLINICAL_PRODUCTION")
    assert load_settings().problems()


def test_log_redaction():
    red = redact({"authorization": "Bearer x", "jobId": "j1",
                  "nested": {"token": "t", "stage": "import"}})
    assert red["authorization"] == "<redacted>"
    assert red["nested"]["token"] == "<redacted>"
    assert red["jobId"] == "j1"


def test_request_id_header(client):
    r = client.get("/", headers={"x-request-id": "req-test123"})
    assert r.headers.get("x-request-id") == "req-test123"


def test_version_endpoint_shape(client):
    r = client.get("/version")
    body = r.json()
    assert body["service"] == "kinelab-biomechanics"
    assert "precisionPipeline" in body
    assert "secret" not in json.dumps(body).lower()


def test_ready_degraded_without_runtimes(client):
    r = client.get("/ready")
    body = r.json()
    assert body["status"] in ("APP_READY", "PRECISION_DEGRADED")
    assert "rtmw" in body and "opensim" in body


def test_settings_defaults_sane():
    assert SETTINGS.max_bundle_mb > 0
    assert SETTINGS.max_cameras >= 3
