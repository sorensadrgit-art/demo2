# KineLab Perception Benchmark V5.5 — real-image biomechanics benchmark + pose-provider selection

Machine-readable results: `artifacts/perception-v55-results.json`.
V5 reference: `services/biomechanics/runtime/vision_v5.py` (+ sweep artifact with `viewAccuracy`).

## 1. Question

V5 proved the calibrated multiview geometry (weighted DLT + iterative
rejection + nonlinear refine) is sound, but the vision front-end fails:
154 identityFails over 9 angles, angleErr max 107.69° / mean 45.90°,
err3d p95 628.4mm. V5.5 asks, with **real images** and a **provider
selection gate**:

1. Where exactly does perception fail (viewpoint map, knee vs ankle)?
2. Does higher input resolution (RTMW-L 384x288) fix it?
3. Can confidence thresholding or reprojection error catch the failures?
4. How big is the synthetic-vs-real gap?
5. Which pose provider should Precision use?

Constraints inherited from V5: no geometry redesign, no new protocols,
no force/EMG/IMU fusion, no UI/Focus/AutoLock changes, no MediaPipe
replacement. V5.5 adds measurement only.

## 2. Providers under test

| Provider key | Model | Input | Checkpoint SHA-256 (first 12) | Worker |
|---|---|---|---|---|
| `rtmw-l-256x192` (incumbent) | rtmw-l cocktail14, COCO-WholeBody | 256x192 | `ae6459e5…` | :8102 |
| `rtmw-l-384x288` (challenger) | rtmw-l cocktail14 384x288, COCO-WholeBody | 384x288 | `afa589fa…` | :8103 (benchmark only) |

Both implement `PoseBenchmarkProvider`
(`services/biomechanics/app/pose_providers.py`); the RTMW HTTP adapter is
`services/biomechanics/app/providers_rtmw.py`. Selection is by
`KINELAB_PRECISION_POSE_PROVIDER` (default `rtmw-l-256x192`). Both
checkpoints are official OpenMMLab model-zoo weights (CC BY-NC-SA 4.0).

## 3. Viewpoint accuracy map (synthetic, 9 angles x 8 cameras, SEED=20260913)

Per-view 2D detection error vs projected truth, recorded in the V5 sweep
as `viewAccuracy` (no new inference; same renders as V5):

| Camera | n | p50 (px) | p95 (px) | max (px) | L/R swaps |
|---|---|---|---|---|---|
| cam-01 | 72 | 7.0 | 15.2 | 54.7 | 0 |
| cam-02 | 62 | 11.3 | 119.7 | 152.7 | 13 |
| cam-03 | 32 | 61.1 | 175.8 | 201.3 | 19 |
| cam-04 | 72 | 18.7 | 156.4 | 195.4 | 28 |
| cam-05 | 72 | 46.0 | 154.7 | 199.4 | 60 |
| cam-06 | 68 | 17.9 | 145.6 | 177.3 | 15 |
| cam-07 | 32 | 35.0 | 184.4 | 197.2 | 13 |
| cam-08 | 72 | 9.1 | 156.8 | 193.8 | 6 |

Knee vs ankle (px, 9 angles x views):

| Landmark | n | p50 | p95 | max |
|---|---|---|---|---|
| left-knee | 54 | 11.1 | 41.4 | 47.3 |
| right-knee | 54 | 17.0 | 41.1 | 54.7 |
| left-ankle | 66 | 11.9 | 43.0 | 70.6 |
| right-ankle | 66 | 81.0 | 175.1 | 190.6 |

Reading: the failure is **identity/polarity, not localization blur**.
Knees localize (p50 ~11-17px); the flexing-side (right) ankle is
systematically labeled on the wrong limb (p50 81px). Polarity arbitration
stays `ambiguous` on all 8 cameras: the detector never localizes both
knees with motion contrast, so the truth-free fix cannot engage.

## 4. Resolution comparison (same-pose, 0/30/60/90°)

| Angle | 256 swaps | 384 swaps | 256 p50/p95 | 384 p50/p95 | 256 lat p50 | 384 lat p50 |
|---|---|---|---|---|---|---|
| 0° | 13 | 21 | 12.7 / 48.0 | 18.4 / 49.1 | 102ms | 169ms |
| 30° | 22 | 25 | 18.5 / 69.2 | 18.5 / 68.5 | 99ms | 168ms |
| 60° | 18 | 27 | 18.8 / 107.2 | 14.7 / 111.6 | 94ms | 166ms |
| 90° | 18 | 26 | 15.6 / 154.0 | 18.4 / 157.4 | 100ms | 165ms |

384x288 **increases** L/R swaps at every angle, costs ~1.7x latency, and
splits 2D error (better p50 at 60°, worse p95 everywhere). Verdict:
resolution is not the bottleneck — the error is semantic. **NO-GO.**

## 5. Confidence cannot gate the failures (P11/P12)

corr(confidence, error) = **-0.316** (weak). Rejection curve: dropping the
lowest-confidence 50% of observations moves residual p95 only 158→130px.
High-confidence wrong-limb detections pass any threshold. Confidence
thresholding is NOT a safety gate for identity errors.

## 6. Reprojection RMSE cannot catch wrong consensus (P25)

| Angle | angleErr | worst 3D err | triangulation RMSE |
|---|---|---|---|
| 0° | 1.1° | 97.7mm | 1.8-5.9px |
| 30° | 8.4° | 436.5mm | 1.7-7.2px |
| 60° | 31.5° | 585.9mm | 3.4-6.2px |
| 90° | 81.4° | 625.9mm | 4.3-5.7px |
| 120° | 107.7° | 763.0mm | 3.4-5.3px |

When every view agrees on the wrong limb, RMSE stays at 1-7px while the
ankle sits up to 763mm from truth. **Reprojection error is necessary but
not sufficient.** This motivates the anatomical layer below.

## 7. Anatomical consistency layer (P24, truth-free)

`anatomical_consistency()` in
`services/biomechanics/app/anatomy/consistency.py`: segment-length bands
(fixture femur/tibia refs, 30% band), hip→knee→ankle topology, bilateral
separation ≥ 50mm. No truth, no angle expectations — a wrong-structure
catcher, not a precision gate. On the temporal ramp it rejects 9/17
frames (pass 8/17), firing exactly where triangulation RMSE stays low but
structure is wrong. Recommended as a production rejection gate.

## 8. Real-image probe (Domain B: COCO-2017 val, GT GT 2D keypoints)

9 person images with labeled hips/knees/ankles, GT bbox as patient ROI
(no detector error in the loop), flexion coverage 35-180° GT knee angle:

| Provider | n | drops | p50 (px) | p95 (px) | max (px) | lat p50 |
|---|---|---|---|---|---|---|
| 256 | 43 | 1 | 15.7 | 64.2 | 91.3 | 101ms |
| 384 | 44 | 0 | 11.8 | 69.6 | 116.1 | 174ms |

No decisive 384 win (better p50, worse p95 + a 116px outlier). Knees
localize on real photos much as on synthetic; hips are the noisiest
(p50 22-40px — loose clothing/occlusion, not flexion-dependent).
Normalized gap: synthetic errNorm p50 **0.019** vs real **0.044-0.051**
— same-model real error is ~2.5x synthetic. Synthetic renders
**understate** the perception problem; real-image benchmarking is
mandatory going forward. (COCO images: Flickr, CC BY 4.0; used read-only
in /tmp, never committed.)

## 9. Temporal ramp 0→120→0 (P26)

Continuity OK (max frame jump 12.4°, zero jumps > 15° — no jitter), but
the angle **never tracks truth** (err 48-179° every frame): polarity
stays ambiguous across the whole sequence, so every frame triangulates
the mirrored/averaged structure smoothly. Segment CVs (femur .043, tibia
.056) look healthy while the answer is wrong — another proof that
smoothness ≠ correctness. Anatomical gate: 8/17 pass.

## 10. Decision gate (P36)

**RETAIN `rtmw-l-256x192` as the Precision pose provider**
(`KINELAB_PRECISION_POSE_PROVIDER=rtmw-l-256x192` default; no code change
needed — the interface + selection env already land in this commit).

Do NOT promote 384x288: more swaps at every angle, 1.7x latency, no
real-image win. The failure is semantic (L/R identity under occlusion),
not optical — more pixels cannot fix it.

Next steps (not this commit): subject-aware ROI tracking to disambiguate
identity before triangulation; temporal identity filter; wire
`anatomical_consistency` as a production rejection gate; re-run this
benchmark per future provider candidate through `PoseBenchmarkProvider`.
