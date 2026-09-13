# KineLab Physical Camera Validation V6 — Session 01 (BLOCKED: no hardware)

Status: **PHYSICAL PRECISION VALIDATION: BLOCKED** — zero video devices in this
environment. No algorithms were altered (baseline-first rule preserved).

## 1. Workspace

Full KineLab checkout on `recovery/pt-motion-focus-20260912` @ `a7b9a9d`:
FastAPI biomechanics backend (`services/biomechanics`) + React/TS frontend
(`src`, incl. `src/features/focus`). NOT backend-only; no `WORKSPACE_MISMATCH`.

## 2. Baseline regression (pre-hardware, all green)

- Backend: `72 passed, 18 skipped`
- Runtime-gated (RTMW worker + OpenSim 4.6): `89 passed, 1 skipped`
- Frontend vitest: `114 passed (20 files)`; Focus: `23 passed`
- `tsc --noEmit` (lint): clean; `npm run build`: success; Playwright E2E: `9 passed`

## 3. Hardware discovery

- `/dev/video*`: absent; `/dev/v4l`: absent; `lsusb`: unavailable;
  no PCI imaging devices. OpenCV (`cv2 5.0.0`) present but nothing to open.
- Recorded per-camera table: **empty** — no metadata invented.

## 4. Acquisition grade

- Camera count: **0** → grade **BLOCKED**.
- Precision requires ≥3 synchronized/calibrated valid views (prefer 6–8).
  No synthetic substitution performed.

## 5. Synchronization audit

- Method: `NO_HARDWARE`; offsets/drops: NOT_MEASURED. Independent USB cameras
  must never be described as synchronized by nominal FPS alone.

## 6. Calibration

- NOT_PERFORMED. No board, no bundle, no RMSE. Calibration lock/acceptance
  phases are pending hardware.

## 7. Scenarios (all BLOCKED, none attempted)

Patient-only baseline, repeatability, identity A–D, occlusions, exit/return,
orientation rotation, edge-of-volume, similar clothing, count/rate degradation.

## 8. Safety invariants (unchanged, V5.6)

Ambiguity allowed; confident-wrong anatomy forbidden; trial-level resolution
permitted; `ANATOMICAL_SIDE_UNRESOLVED` is a valid safe outcome; reprojection
and detector confidence alone never establish correctness; facing may abstain;
no camera/azimuth swap hacks; Precision measurement requires resolved identity;
safe suspension preferred over incorrect measurement.

## 9. Synthetic contrast (not a substitute)

V5.6 synthetic baseline: joint identity margin 34.9 on walk-cycle renders,
per-frame + cross-frame median triangulation, 18/18 identity tests,
2/2 precision_v56 integration tests. Physical validation requires real human
RGB through the production Precision endpoint (`ClinicalMeasurement` or
structured suspension) — not low-level function calls.

## 10. What unblocks V6

1. ≥3 fixed, synchronized physical cameras with manual exposure/focus.
2. Chessboard/Charuco intrinsics + global extrinsics bundle (locked, RMSE gated).
3. Anonymous subject; 5× slow left-knee AROM baseline; full scenario battery.
4. Evidence: screen capture, room video, `identity-events.jsonl`,
   `measurement-telemetry.csv`, 12 screenshots, 10 clips, `SHA256SUMS.txt`.

## 11. Limitations

Container without device passthrough cannot validate physical optics, sync,
lighting, motion blur, or human-detector behavior. All physical metrics in
`artifacts/physical-v6-validation.json` are explicit nulls, not zeros.

## 12. Readiness

**NOT_READY** (`READY_FOR_REFERENCE_INSTRUMENT_VALIDATION` requires physical
scenarios with zero wrong-side/wrong-person finalized measurements).
