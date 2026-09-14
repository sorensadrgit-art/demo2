# KineLab Third-Party Notices (R1)

Generated 2026-09-14 from `package.json` / `pyproject.toml` / model
manifests. Transitive licenses via `npm audit` metadata and PyPI project
records; full texts apply from the respective packages.

## Runtime frontend

| Package | Version | License |
|---|---|---|
| react / react-dom | 18.3.1 | MIT |
| react-router-dom | 6.30.6 | MIT |
| three | 0.169.0 | MIT |
| zustand | 4.5.7 | MIT |
| @mediapipe/tasks-vision | 0.10.35 | Apache-2.0 |

## Build / test tooling (not shipped to patients)

vite / vitest / @vitejs/plugin-react / tailwindcss / playwright /
@testing-library/react / jsdom — MIT or Apache-2.0 per package.

## Backend runtime

| Package | Version | License |
|---|---|---|
| fastapi | 0.141.1 | MIT |
| uvicorn | 0.52.4 | BSD-3-Clause |
| pydantic | 2.13.5 | MIT |
| numpy | 2.5.3 | BSD-3-Clause |
| scipy | 1.18.1 | BSD-3-Clause |
| opencv-python-headless | 4.12.0.88 | Apache-2.0 |
| httpx | 0.28.1 | BSD-3-Clause |

## Scientific runtimes (isolated worker envs, not bundled)

- torch 2.4.1+cpu — BSD-style (see pytorch.org)
- mmpose 1.3.2 / mmcv 2.2.0 / mmengine 0.10.7 — Apache-2.0
- OpenSim 4.6 — Apache-2.0 (simtk.org)

## Scientific model assets (NOT redistributed in this repo)

| Asset | Source | License | Commercial | Redistribution |
|---|---|---|---|---|
| RTMW-L 256x192 checkpoint (`rtmw-l_256x192.pth`, sha `ae6459e5…`) | OpenMMLab model zoo | CC BY-NC-SA 4.0 | NOT permitted | NOT permitted |
| gait2392_thelen2003muscle.osim (sha `3af1ca20…`) | opensim-models (GitHub) | CC-BY 3.0 | permitted with attribution | permitted with attribution |

Checkpoint + model weights are provisioned at build/first-run and verified
by SHA-256; they are never committed (see `.gitignore`).
