# KineLab Neutral-Angle Bias Report V4

## 1. Original bias
V3 golden knee trajectory (synthetic markers → `opensim_ik.py` → gait2392 IK):

| truth | 0° | 5° | 10° | 15° | 30° | 45° | 60° | 90° | 120° | 150° |
|---|---|---|---|---|---|---|---|---|---|---|
| recovered | −5.09° | −2.98° | −0.75° | 1.85° | 30.30° | 44.14° | 59.38° | 91.17° | 122.80° | 153.31° |
| error | −5.09° | −7.98° | −10.75° | −13.15° | +0.30° | −0.86° | −0.62° | +1.17° | +2.80° | +3.31° |

Not a constant offset: error grows 0°→15°, then snaps to ≤3° mid-range.
Reproduce: `python3 services/biomechanics/runtime/bias_study.py --model
services/biomechanics/models/opensim/gait2392_thelen2003muscle.osim
--out /tmp/bias_origin --attach origin`.

## 2. Reproducing experiment
`bias_study.py` generates markers FROM the model itself
(`findStationLocationInGround` at exact known coordinates) and runs real
`InverseKinematicsTool`. Solver input is therefore exact; any error is the
fitting chain's, not measurement noise.

## 3. OpenSim round-trip bias: NONE
Same data, model markers attached at the generation stations
(`KINELAB_IK_ATTACH_JSON`, V4 default):

| truth | 0 | 5 | 10 | 15 | 30 | 45 | 60 | 90 | 120 | 150 |
|---|---|---|---|---|---|---|---|---|---|---|
| error | 0.000 | 0.001 | 0.002 | 0.003 | 0.000 | 0.000 | −0.002 | 0.000 | 0.000 | 0.011 |

Max error **0.011°** → passes the Phase-22 <1° target. The IK solver,
coordinate convention (`knee_angle=0` IS clinical neutral), and TRC path are
all correct. `test_opensim_roundtrip_{zero,30,60,90,120}` lock this in.

## 4. KineLab marker generation caused it
V3 `opensim_ik.py` attached every model marker at its body origin
(`set_location(Vec3(0,0,0))`) while TRC data held surface stations. The
least-squares solver compensated the systematic offset by twisting pelvis
tilt (~40° at the 0° frame vs 0° truth) and hip flexion (−45° vs 0° truth);
near straight-leg the knee coordinate absorbed the residual. Dominant cause:
**marker model-vs-data mismatch** (spec items: model marker placement +
virtual marker generation). Fixed by station attachment; origin mode kept
only behind `--attach origin` for comparison.

## 5. Scaling influence: YES, secondary (~3.6° at 5% size error)
Data stations scaled ×1.05 vs unscaled model: max error 3.56° (broad curve,
worst mid-range). Production chain needs per-patient scaling (ScaleTool);
until then, scale mismatch is reported, not hidden.

## 6. Marker weights: no effect (default weights → 0.011°)
## 7. Neutral-reference convention: verified, no offset needed
Model zero round-trips to exactly 0.000°. Synthetic path needs no neutral
offset. Patient-specific neutral remains architected (`clinical_rom`) but is
never auto-applied.

## 8. What changed
`opensim_ik.py` accepts `KINELAB_IK_ATTACH_JSON` station map; V4 schema
`app/opensim/markers_v4.py` defines 12 lower-extremity markers (5 direct,
7 derived with inputs + uncertainty); derived-station offsets are
model cross-checked at neutral (hipC/kneeC/ankleC, femur 0.3958 m).

## 9. Residual bias
Model-derived path: ≤0.011°. Sparse 6-marker set: ≤0.004° (density has no
effect once stations match). 5 mm marker noise: ≤1.35°; 10 mm: ≤2.83°
(predicts vision-chain accuracy; drives reprojection-RMSE quality gates).

## 10. Absolute vs ROM
`clinical_rom(raw, neutral)`: absolute coordinate always preserved; ROM is
`raw − neutral` only with an explicit patient calibration recorded in
provenance. No blind constant correction was applied anywhere (Phase 21).
