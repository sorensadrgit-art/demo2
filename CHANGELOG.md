# KineLab Changelog

## 0.1.0-beta (R1 — publication & production readiness)

Software publication hardening only; no biomechanics redesign, no new
accuracy claims.

- Focus workflow (patient → assessment → treatment → review), Lab workflow
  (measure / goniometer / symmetry / 3D / report / progress), Analysis
  workspace, SessionReport with experimental disclaimers.
- Precision V5.6 pipeline (RTMW-L 256×192 → sync gate → identity arbitration
  → triangulation → anatomical gate → OpenSim IK) with safe suspension and
  per-measurement provenance.
- V6.1 physical capture bundle tooling: `pack` / `inspect` CLI, typed
  `/capture/import` gates, `/precision/process_capture` into the same V5.6
  runner, operator session script.
- R1 hardening: env contract, startup validation, JSON logging with
  redaction, request ids, `/version` + `/ready`, CORS without wildcard,
  CSP/security headers, capture path confinement + quotas, ErrorBoundary,
  backend-degraded UX, containers + compose, CI, SBOMs, notices, runbook.

Known limitations: physical V6 validation blocked pending real capture;
clinical reference validation pending; RTMW checkpoint is non-commercial
(CC BY-NC-SA); no application license chosen yet; no authentication in R1.
