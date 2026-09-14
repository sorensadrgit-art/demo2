# KineLab Deployment (R1)

## Requirements

- Docker + Compose (or Node 22 + Python 3.13 hosts), 8 GB RAM recommended.
- Model assets (provisioned, checksummed, never in Git):
  RTMW-L checkpoint `ae6459e5…` + `rtmw-l_8xb1024-270e_cocktail14-256x192.py`
  config; OpenSim `gait2392_thelen2003muscle.osim` (`3af1ca20…`).
- No physical cameras required for the software release; Precision is
  `PRECISION_DEGRADED` without RTMW/OpenSim and the app stays usable.

## Environment

Copy `.env.example` → `.env`. Required in production:
`KINELAB_RELEASE_CHANNEL` (never `CLINICAL_PRODUCTION` in R1),
`KINELAB_CORS_ORIGINS` (explicit, no `*`), `KINELAB_STORAGE_ROOT`,
`KINELAB_RTMW_URL`, `KINELAB_OPENSIM_MODEL`, capture quotas.
`npm run dev` is not production hosting.

## Storage

- `KINELAB_STORAGE_ROOT` (`/data` in compose): measurements, calibrations,
  session registry. Back up `/data`; `/models` is a checksum-verified cache;
  `/cache`, `/logs` are disposable.
- App code is read-only at runtime; writes only to data/cache/models/logs.

## Containers

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

- `web` (public `:8080`): nginx + static build, `/api` → backend (20-min
  timeouts for Precision jobs), CSP/security headers, RTMW never exposed.
- `backend`: non-root, startup config validation, `/health` liveness +
  `/ready` readiness (`APP_READY` / `PRECISION_DEGRADED`), `/version`.
- `rtmw`: isolated worker, model-SHA gate, health requires `modelLoaded`.

## Reverse proxy / HTTPS

TLS terminates at the platform/proxy in front of `web`. Keep `/api`
timeouts ≥ 20 min; do not cache patient-specific responses; HTML `no-cache`,
hashed assets immutable.

## Startup / health / upgrade / rollback / backup

- Start: `./scripts/start_production.sh` (local) or compose; verify
  `/ready` + `./scripts/release_doctor.sh`.
- Upgrade: pull → rebuild → model checksum verify → restart → health check.
- Rollback: previous image/build tag; `/data` patient evidence is immutable
  and untouched by rollback.
- Backup: snapshot `/data`; restore smoke = start → `/ready` → demo ingest.
