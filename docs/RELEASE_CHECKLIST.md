# KineLab Release Checklist (run before every release)

1. `./scripts/release_doctor.sh` — zero BLOCK (WARN ok only if understood).
2. `./scripts/release_check.sh` — vitest + tsc + build + backend + smoke.
3. `npx playwright test` — E2E green (Chromium minimum).
4. Confirm `VITE_E2E_MODE` is unset/false in the production build.
5. Confirm no weights/venv/dist/secrets tracked (`git status`, doctor).
6. Review `docs/VALIDATION_STATUS.md` wording in any new UI/report text.
7. Rebuild containers, verify `/ready` + `/version` on the candidate.
8. Record evidence under `artifacts/release-r1/` (test summary, metadata).
9. Tag `vX.Y.Z-beta.N` only after gates pass; never merge to main unasked.
