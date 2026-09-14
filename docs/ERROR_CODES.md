# KineLab Error Code Catalog (R1)

Stable wire codes. Expected scientific failures are structured values,
never generic 500s. Frontend maps each code to a human-readable message
(see `src/app/BackendStatus.tsx` for the degraded-Precision mapping).

## Precision / identity

| Code | Meaning | UI behavior |
|---|---|---|
| `POSE_PROVIDER_UNAVAILABLE` | RTMW worker unreachable or model not loaded | Precision suspended; realtime stays |
| `BIOMECHANICAL_MODEL_UNAVAILABLE` / `IK_FAILED` / `IK_HIGH_RESIDUAL` | OpenSim did not execute / failed / residual too high | No `biomechanical-model` label without a real solve |
| `ANATOMICAL_SIDE_UNRESOLVED` | Multiview identity margin below threshold | Suspend, never guess |
| `POLARITY_AMBIGUOUS` | Left/right polarity unresolved | Suspend, never guess |
| `ANATOMICAL_INCONSISTENCY` | Truth-free anatomy gate rejected the solution | Suspend with reason |
| `PRECISION_QUALITY_SUSPENDED` | Generic quality suspension envelope | Shows embedded reason |
| `INSUFFICIENT_VIEWS` | Fewer than `minViews` usable views | Suspend |
| `FRAME_SYNC_INVALID` | Per-frame comb exceeds 16ms tolerance | Suspend / exclude camera |
| `TRIANGULATION_DEGENERATE` / `TRIANGULATION_HIGH_REPROJECTION_ERROR` | Geometry failure | Suspend |

## Capture ingest (V6.1)

| Code | Meaning |
|---|---|
| `CAPTURE_BUNDLE_INVALID` | Malformed bundle, traversal/quota violation, missing metadata |
| `CAPTURE_CHECKSUM_MISMATCH` | Source recording hash mismatch — blocks processing (never warning-only) |
| `CAPTURE_CAMERA_MISSING` | Manifest/calibration/directory id mismatch |
| `CAPTURE_TIMESTAMP_MISMATCH` | Non-monotonic, gapped, or frame-count-mismatched timestamps |
| `CAPTURE_NOT_SYNCHRONIZED` | UNSYNCHRONIZED declaration or start spread > 16ms |
| `CAPTURE_CALIBRATION_MISMATCH` | Calibration id / intrinsics / dims incompatible |
| `CAPTURE_TOO_FEW_CAMERAS` | Grade below Precision minimum |

## Calibration

`CALIBRATION_INSUFFICIENT_IMAGES` · `CALIBRATION_BAD_COVERAGE` ·
`CALIBRATION_HIGH_REPROJECTION_ERROR` · `CAMERA_NOT_CALIBRATED`.

## Operational

`INTERNAL_ERROR` (with `requestId`) · `POSE_INFERENCE_FAILED`.
Every response carries `X-Request-Id` for audit.
