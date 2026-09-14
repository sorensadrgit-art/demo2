# KineLab Publication Readiness (R1)

## SOFTWARE

| Area | Verdict | Evidence |
|---|---|---|
| Frontend | PASS | vitest 114, tsc clean, build ok, E2E 9 |
| Backend | PASS | 88 passed + 17 security tests; typed errors |
| Build | PASS | `npm run build` + Dockerfiles + compose |
| Tests | PASS | unit/backend/E2E/capture-security green |
| Deployment | PASS | compose stack, nginx, start/stop, runbook |
| Security | WARN | hardening done; no auth (private/demo use) |
| Operations | PASS | doctor/check/smoke, backup/rollback docs |
| Documentation | PASS | README/DEPLOYMENT/RUNBOOK/SECURITY/PRIVACY |

## SCIENCE

| Area | Verdict | Evidence |
|---|---|---|
| Synthetic | PASS | V4/V5.5/V5.6 synthetic suites green |
| Precision engineering | PASS | V5.6 pipeline + gates tested |
| Physical | BLOCK | BLOCKED_PENDING_CAPTURE (no cameras) |
| Clinical reference | BLOCK | V7 pending |

## LEGAL / LICENSE

| Area | Verdict | Evidence |
|---|---|---|
| Application license | BLOCK | APPLICATION_LICENSE_DECISION_REQUIRED |
| Third-party licenses | PASS | THIRD_PARTY_NOTICES.md + SBOMs |
| RTMW commercial rights | BLOCK | CC BY-NC-SA → COMMERCIAL_RELEASE_BLOCKED_BY_MODEL_LICENSE |
| Model redistribution | BLOCK | checkpoint not redistributable |

## DATA

| Area | Verdict | Evidence |
|---|---|---|
| Privacy architecture | PASS | data-flow doc, local-only runtimes |
| Authentication | BLOCK | PATIENT_DATA_PRODUCTION_BLOCKED_AUTH |
| Retention | WARN | documented defaults, operator-owned |
| Deletion | WARN | operator procedure, no patient self-serve UI |

Overall: software publishable as Research Preview (private/demo data);
commercial and clinical production blocked for stated reasons.
