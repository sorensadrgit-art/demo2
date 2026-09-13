# KineLab Physical Capture Bridge V6.1

Status: **ingest/bridge implementation complete, engineering tests green.**
Physical validation remains BLOCKED (V6: zero cameras in this container) —
this bridge runs on a physical capture workstation + real backend.

## 1. What V6.1 builds (bridge only — no science modified)

| Layer | File | Notes |
|---|---|---|
| Bundle schema | `services/biomechanics/app/capture/bundle.py` | manifest, timestamps, checksums, sync, calibration bridge |
| Client spec | `services/biomechanics/app/capture/client.py` | CameraSource/SyncSource; file-import is the production path |
| Ingest API | `services/biomechanics/app/api/capture_v61.py` | POST `/capture/import`, GET `/capture/sessions/{sid}` |
| Process API | same | POST `/precision/process_capture` → SAME V5.6 runner |
| CLI | `services/biomechanics/scripts/kinelab_capture.py` | `pack` + `inspect` |
| Session runner | `services/biomechanics/scripts/run_physical_v6.sh` | 8-step validation session |
| Errors | `app/domain/errors.py` | 7 typed codes, never generic 500s |

V5/V5.5/V5.6 science, fixtures, thresholds: untouched.

## 2. Capture bundle format (Phases 1-7)

```
session-<uuid>/
  manifest.json                  schema kinelab-capture-bundle-v6.1
  calibration/calibration.json   KineLab calibration schema (intrinsics +
                                 distortion + projectionMatrix + RMSE)
  cameras/<camId>/video.mp4      (or frames/NNNNNN.png) + timestamps.csv
  events.jsonl                   session events (optional)
  SHA256SUMS.txt                 sha256 of every file above
```

- `timestamps.csv`: `frameIndex, monotonicTimestampNs[, hardwareTimestampNs]`
- `synchronizationMethod`: HARDWARE_TRIGGER | PTP | GENLOCK | SHARED_CLOCK |
  SOFTWARE_SYNC | UNSYNCHRONIZED. Declared in manifest AND verified:
  start-spread ≤ 16.0ms across cameras, else CAPTURE_NOT_SYNCHRONIZED.
- `captureOrigin: "physical"` requires real recordings + physical camera
  metadata (manufacturer/model/interface non-null on ≥1 camera).
  A string alone is never trusted.
- Calibration compatibility: bundle `calibrationId` == manifest
  `calibrationId`; every manifest camera needs intrinsics (fx/fy/cx/cy),
  projectionMatrix, and matching image dims.
- Acquisition grade: ≥3 cams → `precision`; 2 → `clinical`; 1 → `solo`.
  Precision requires `precision` grade + verified sync.

## 3. Ingest endpoint (Phases 8-11)

`POST /capture/import {"bundlePath": "<server-local path>"}` validates in
order — manifest parse → schema version → calibration parse → checksums →
camera-id cross-check → cameraCount → calibration wiring → timestamps
(monotonic, gapless, frames==timestamps) → sync gate → physical-metadata
gate → grade — and registers the session (originals never written).

Typed failures: CAPTURE_BUNDLE_INVALID · CAPTURE_CHECKSUM_MISMATCH ·
CAPTURE_CAMERA_MISSING · CAPTURE_TIMESTAMP_MISMATCH ·
CAPTURE_NOT_SYNCHRONIZED · CAPTURE_CALIBRATION_MISMATCH ·
CAPTURE_TOO_FEW_CAMERAS. Failures return 200 with an `error` value so the
operator sees WHICH gate tripped.

## 4. Frame processing + V5.6 (Phases 12-16)

`POST /precision/process_capture`:
1. rejects unknown sessions and non-precision grades / minViews < 3;
2. selects frames: optional `cameraSubset` (no rerecording),
   `[trialStartS, trialEndS]` window, deterministic `downsampleFps` stride;
3. aligns selections into synchronized frame sets with per-set `combMs`;
4. decodes each frame deterministically (mp4 keyframe seek /
   image sequence) and runs the REAL RTMW worker (`rtmw_infer`);
5. converts bundle calibration via `calibration_to_v56` (key rename only)
   and calls the SAME `process_v56` job runner — no duplicated science;
6. attaches physical provenance to `measurement.provenance` AND
   `stages.physicalCapture`: session id, origin REAL_PHYSICAL_CAPTURE,
   trial window, camera subset, downsample stride/effective Hz, per-camera
   recording + timestamp hashes, calibration + manifest hashes,
   pipeline version, sync tolerance, rtmw/identity/multiview/opensim flags.

## 5. Client + CLI (Phases 17-20, 31)

- `CameraSource` / `SyncSource` protocols: the contract an external rig
  (Qualisys/Vicon/machine-vision/…) adapts to. No vendor SDKs here.
- `FileCameraSource`: file-import path (video + timestamps.csv).
- `kinelab-capture pack`: assembles bundle, copies originals, writes
  SHA256SUMS.txt. `kinelab-capture inspect`: reports cameras, resolution,
  FPS, sync, frames, duration, calibration id, checksum status, and
  Precision eligibility — no processing.
- `run_physical_v6.sh <bundle> [startS] [endS]`: inspect → runtime check →
  import → process → `validation/V6/<session-id>/processing-report.json`.

## 6. INGEST FIXTURE + tests (Phases 21-22, 34-35)

`tests/capture_fixtures/build_ingest_fixture.py` builds a deterministic
3-cam × 6-frame bundle (320×240 mp4 + SHARED_CLOCK timestamps + consistent
calibration). Stick-figure renders labeled INGEST FIXTURE everywhere —
mechanics only, NOT physical validation, NOT a patient.

`tests/test_capture_v61.py` (16 tests): 6 typed-failure gates, grade gates
(precision/clinical + process gate), decode determinism, frame-set sync,
subset, downsample, provenance links, SAME-pipeline wiring
(`kinelab-precision-v5.6`, identity stage, biomechanical-model source),
bundle→measurement e2e (stubbed RTMW/IK), direct `validate_bundle`.

Precision gating (Phase 41): V5 minimum views (≥3), sync (≤16ms comb),
calibration, grade are enforced; UNSYNCHRONIZED bundles are rejected.
Temporal association (Phase 42): frame sets keyed by timestamp order with
comb recorded — no drift-prone nearest-neighbor.

## 7. Evidence layout (Phase 23-28, code-level)

`validation/V6/<session-id>/` holds `processing-report.json` (full job
response incl. provenance). Every measurement links: session, recording
hashes, timestamp hashes, camera list, frame indices, calibration id +
hash, manifest hash, trial window, sync comb/method.

Phase 30 (real vs synthetic): enforced in code — physical metadata gate
at import + REAL_PHYSICAL_CAPTURE origin only after that gate passes.
The INGEST FIXTURE can import (it carries file recordings + interface
metadata) but is labeled fixture in manifest/calibration/events.

## 8. Operator checklist (Phase 39)

- [ ] ≥3 hardware-triggered/PTP/GenLock cameras, fixed mounts
- [ ] board calibration; RMSE ≤ gate; calibrationId recorded
- [ ] record trial; collect videos + per-camera timestamps.csv
- [ ] `kinelab-capture pack …` → copy bundle to backend host
- [ ] `kinelab-capture inspect` → eligibility YES
- [ ] `run_physical_v6.sh <bundle> [startS] [endS]`
- [ ] review `validation/V6/<session-id>/processing-report.json`:
      state COMPLETE, quality ACCEPT, provenance hashes present

## 9. Verification (Phase 37)

- Capture suite: 16 passed
- Backend: see final report (full run after this doc)
- Frontend / focus / tsc / build / e2e: see final report
