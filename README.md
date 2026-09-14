# KineLab — Motion Analysis Laboratory (Research Preview)

KineLab is an experimental physical-therapy motion-analysis platform:
therapist-first Focus workflow, Lab measurement tools, and an experimental
multiview Precision biomechanics pipeline (RTMW → triangulation → identity
arbitration → OpenSim IK) with physical capture-bundle import.

> Experimental motion-analysis software. Measurements are undergoing
> physical and clinical validation and should not be used as the sole basis
> for diagnosis or treatment decisions.

## Current status

- Software: publishable as **Public Research Preview** (private/demo data).
- Physical V6 validation: **BLOCKED_PENDING_CAPTURE** (no real ≥3-camera
  session yet). Clinical reference validation: **pending**.
- Commercial release: **blocked by RTMW checkpoint license (CC BY-NC-SA)**.
- No application license chosen yet (`APPLICATION_LICENSE_DECISION_REQUIRED`).

## Architecture

- `src/` — React/TS app (Focus, Lab, Analysis, measurement core, capture rig).
- `services/biomechanics/` — FastAPI backend (calibration, reconstruction,
  identity, Precision V5.6, capture V6.1) + RTMW/OpenSim runtimes.
- `tests/` + `services/biomechanics/tests/` — vitest, pytest, Playwright.

## Quick start (production-like)

```bash
cp .env.example .env   # edit origins, storage, model paths
./scripts/start_production.sh
./scripts/release_doctor.sh
```

## Development

```bash
npm install && npm run dev          # web :8011
python3 -m uvicorn app.main:app --app-dir services/biomechanics --port 8101
bash services/biomechanics/scripts/provision_rtmw.sh
```

## Tests

```bash
npx vitest run && npx tsc --noEmit && npm run build
python3 -m pytest services/biomechanics/tests -q
npx playwright test
./scripts/release_check.sh
```

## Physical capture

Workstation → `kinelab-capture pack` → `inspect` → `POST /capture/import` →
`POST /precision/process_capture`. Details: `docs/PHYSICAL_CAPTURE_BRIDGE_V61.md`.

## Precision pipeline

RTMW-L 256×192 observations → 16 ms sync gate → exhaustive 2^C identity
solve → weighted-DLT triangulation → anatomical gate → OpenSim IK →
`ClinicalMeasurement` with provenance, or typed suspension (never a guess).

## Limitations / validation / licensing

See `docs/VALIDATION_STATUS.md`, `docs/PUBLICATION_READINESS.md`,
`THIRD_PARTY_NOTICES.md`, `docs/REGULATORY_GAP.md`.
