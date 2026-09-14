# KineLab Operations Runbook (R1)

All responses: capture `X-Request-Id`, check `/ready`, then act. Never
label fallback geometry `biomechanical-model` when OpenSim did not run.

## Frontend unavailable

Check `web` container / preview process, nginx config, `dist/` freshness.
Safe restart; no patient evidence lives in the web tier.

## Backend unavailable

UI shows “Precision analysis unavailable — realtime remains available.”
Restart backend, verify `/health` → `/ready`; config failures print the
exact variable (see `.env.example`).

## RTMW unavailable

Precision jobs suspend with `POSE_PROVIDER_UNAVAILABLE`; treatment UI stays
stable. Check worker logs, model checksum (`ae6459e5…`), port 8102,
`KINELAB_RTMW_URL`. Never serve inference from a checksum-mismatched model.

## OpenSim failure

Jobs suspend (`IK_FAILED` / `BIOMECHANICAL_MODEL_UNAVAILABLE`); report shows
suspension, not a model label. Verify model path + SHA `3af1ca20…`.

## Capture import failure

Read the typed code (`docs/ERROR_CODES.md`): checksum → re-copy bundle;
timestamps → re-export clocks; sync → verify trigger/PTP; calibration →
matching `calibrationId` + dims. Quota errors list the exact limit var.

## Disk full / unwritable storage

Backend returns controlled typed failures; free `/data`, clear `/cache`,
restart, re-run `./scripts/release_doctor.sh`.

## Corrupted model

Worker refuses startup on SHA mismatch: re-provision from the official
source, verify SHA, restart.

## Failed Precision job

Inspect stages + `error.code`; originals under `var/capture/` are immutable;
retry creates a new job id and never overwrites evidence.

## Storage recovery

Restore `/data` snapshot → start → `/ready` → spot-check a prior session
registry entry.
