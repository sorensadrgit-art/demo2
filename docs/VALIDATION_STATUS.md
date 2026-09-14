# KineLab Validation Status (R1 — prevents marketing drift)

## ENGINEERING VERIFIED

- Backend `88 passed, 18 skipped` (model-gated skips documented); frontend
  `114 passed`; `tsc` clean; production build succeeds; Playwright E2E
  `9 passed`; capture-security suite `17 passed`.
- Weighted-DLT triangulation, sync gating (16 ms), identity arbitration,
  provenance wiring, and bundle ingest are covered by automated tests.
- RTMW reproducibility procedure documented (`docs/RTMW_REPRODUCIBILITY_V4.md`);
  checkpoint SHA-256 verified at provision.

## SYNTHETIC VERIFIED

- V4 neutral-angle round-trip ≤ 0.011°; sparse-marker and noise studies recorded.
- V5.5 perception benchmark: RTMW-L 256×192 retained; resolution is not the
  bottleneck (semantic identity failures); real error ≈ 2.5× synthetic.
- V5.6 synthetic identity: joint margin 34.9, 18/18 identity + 2/2
  precision integration tests green.

## PHYSICAL VALIDATION: BLOCKED_PENDING_CAPTURE

- `PHYSICAL PRECISION VALIDATION: BLOCKED` — zero camera devices in the
  reference container; no synthetic substitution performed.
- V6.1 capture bridge (bundle → ingest → Precision V5.6) is implemented and
  tested with the labeled INGEST FIXTURE, but no real ≥3-camera synchronized
  physical session has been processed. Do not claim otherwise.

## CLINICAL REFERENCE VALIDATION: PENDING (V7 future work)

- No reference-instrument comparison, no accuracy claim, no diagnostic claim.
- Research Preview may ship as experimental software with disclosures; it
  must not be presented as clinically validated.

## Forbidden claims (unenforced by evidence)

FDA APPROVED · CLINICALLY VALIDATED · DIAGNOSTIC · MEDICAL GRADE ·
99% ACCURATE · CLINICAL GRADE · HIPAA compliant (as a product claim).
