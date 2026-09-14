# KineLab Security Policy (R1)

## Scope

Research-preview motion-analysis software. Internet-facing PHI deployment
is blocked until authentication/authorization, retention/deletion UX, and
regulatory review land (see `docs/PUBLICATION_READINESS.md`).

## Reporting vulnerabilities

Use GitHub private vulnerability reporting on this repository
(Security tab → Report a vulnerability). If unavailable, open a minimal
issue without proof-of-concept data and request a private channel.
Do not invent a monitored email here — the repo owner must configure one.

## Hardening already in place

- Explicit CORS origins (no `*`); CSP + nosniff + anti-framing headers.
- Capture import confinement (allowed roots, traversal/symlink rejection),
  configurable size/camera/row quotas, checksum-must-pass, originals immutable.
- Structured logs with secret/image redaction; `X-Request-Id` audit trail.
- Non-root containers, read-only code, RTMW internal-only, no secrets in Git.

## Known residual risks

- No authentication in R1: deploy Research Preview with demo/deidentified
  data behind private access only.
- Dev npm advisories (vitest/vite/esbuild, react-router moderate) — build-time
  only, no runtime production dependency affected.
