# KineLab Privacy & Data Flow (technical, not a legal policy)

## What data enters

- Solo/webcam: live frames processed on-device via MediaPipe; patient
  selection/assessments entered by the therapist.
- Physical capture: external workstation bundle (videos/frames +
  timestamps.csv + calibration) imported server-locally via
  `POST /capture/import`; originals never modified.

## Where it goes

- Frontend `sessionStore` (in-memory) + versioned `StoredSession` layers
  (raw / reconstructed / derived / interpreted kept separate).
- Backend `var/capture/<session>/` (registry copies of manifest/calibration,
  never original recordings) and `var/calibrations/`.
- RTMW worker + OpenSim subprocess run locally (127.0.0.1 / subprocess);
  no patient imagery leaves the machine in the reference deployment.

## What persists / retention

- Measurements, calibration bundles, imported session registry, logs.
- Defaults: raw captures retained until operator deletion; derived caches in
  `var/` are regenerable; logs rotate by deployment. Configure
  `KINELAB_STORAGE_ROOT` and back up `/data` (measurements, calibrations,
  session registry). Model weights are caches, re-provisionable by checksum.

## What leaves the machine / third parties

- None by default. No analytics SDK is bundled; no patient identity, raw
  recordings, landmarks, or measurements are sent to third parties.
  Any future analytics requires explicit opt-in and a data-flow update.

## Deletion

- Operator deletes the session directory under `var/capture/` plus the
  source bundle copy; derived caches are safe to remove (re-derivable).
  No patient-facing self-service deletion UI exists in R1 — document this
  to deploying organizations (release blocker for internet-facing PHI).

## Logs

- JSON lines with request/session/trial/job ids, stage, error codes,
  durations. Never: raw images, image bytes, API keys, Authorization
  headers, tokens, biometric embeddings (see `logging_util.redact`).

A formal Privacy Policy for publication requires owner/legal review and is
not included here.
