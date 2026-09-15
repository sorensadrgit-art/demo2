# KineLab Solo V6.3 Physical Webcam Validation

**Status: PENDING PHYSICAL EXECUTION**  
**Clinical accuracy: NO**  
**Preview Classification: Public Research Preview**

> **IMPORTANT DISCLAIMER**  
> KineLab Solo V6.3 is a single-camera 2D screen-plane motion estimation framework provided strictly as a **Public Research Preview**. It is **NOT** a medical device and has **NOT** been cleared or approved by any regulatory authority. Clinical accuracy is explicitly rated **NO**. It must not be relied upon for surgical planning, diagnostic judgment, or autonomous clinical decision-making. All measurements require validation against gold-standard optical or goniometric instruments by a licensed clinician.

---

## 1. Test Environment & Hardware Specification

| Field | Configuration / Value |
| :--- | :--- |
| **Hostname** | `soooren` |
| **System Model** | `Alienware m18 R2` |
| **Operating System** | `Windows 11` |
| **Primary Video Capture Device** | `Integrated Webcam RGB` |
| **Auxiliary Sensors** | `Integrated IR` (*IR is not a viewpoint / not for pose tracking*) |
| **Usable Monocular Viewpoints** | 1 (Single RGB Webcam) |
| **Target Browser** | Google Chrome / Microsoft Edge (Chromium, WebGL 2.0 active) |
| **Pose Provider** | `MediaPipePoseProvider` (BlazePose Full, single monocular RGB feed) |
| **Smoothing Filter** | One Euro filter (`fcmin = 1.0 Hz`, `beta = 0.007`) |
| **Dev Validation Harness Route** | `/?soloValidate=1` |

---

## 2. Validation Scope & Quality Gates

KineLab Solo V6.3 operates without external multi-camera calibration or OpenSim biomechanical triangulation. Instead, it enforces strict monocular runtime safety invariants:

1. **Required View Enforcement**:
   - Sagittal protocols require `LEFT_SAGITTAL` or `RIGHT_SAGITTAL` based on affected side.
   - Bilateral lower-limb protocols require `SAGITTAL`.
   - Shoulder Abduction requires `FRONTAL`.
   - Out-of-plane yaw exceeding threshold triggers `WRONG_VIEW` suspension.
2. **Framing & Proximity Gating**:
   - Patient too close (`PATIENT_TOO_CLOSE`) or too far (`PATIENT_TOO_SMALL`) halts measurement.
   - Boundary clipping (`JOINT_CLIPPED`) or joint occlusion (`LANDMARK_OCCLUDED`) immediately suspends trial recording.
3. **Single Positioning Cue**:
   - At most one actionable coach instruction rendered at any time (e.g., *Move back*, *Turn to required camera plane*, *Keep ankle visible*).
4. **Keyboard Accessibility**:
   - Start (`Enter` / button), Stop / End Trial, and Retry are fully keyboard accessible with distinct focus rings.

---

## 3. Protocol Validation Matrix & Repeatability

All physical measurements on the test machine are currently marked `PENDING` until live webcam execution is recorded.

### Protocol 1: Knee Flexion AROM (Left Side)
- **Required View**: `LEFT_SAGITTAL`
- **Target Joint**: `leftKnee`
- **Trial 1 Excursion**: `PENDING`
- **Trial 2 Excursion**: `PENDING`
- **Trial 3 Excursion**: `PENDING`
- **Mean ROM**: `PENDING`
- **Standard Deviation**: `PENDING`
- **Coefficient of Variation (CV%)**: `PENDING`
- **Mean Abs Filter Delta (|Filt - Raw|)**: `PENDING`
- **View Stability Ratio**: `PENDING`
- **Verdict**: `PENDING`

### Protocol 2: Knee Extension AROM (Left Side)
- **Required View**: `LEFT_SAGITTAL`
- **Target Joint**: `leftKnee`
- **Trial 1 Excursion**: `PENDING`
- **Trial 2 Excursion**: `PENDING`
- **Trial 3 Excursion**: `PENDING`
- **Mean ROM**: `PENDING`
- **CV%**: `PENDING`
- **Verdict**: `PENDING`

### Protocol 3: Shoulder Flexion (Right Side)
- **Required View**: `RIGHT_SAGITTAL`
- **Target Joint**: `rightShoulderFlex`
- **Trial 1 Excursion**: `PENDING`
- **Trial 2 Excursion**: `PENDING`
- **Trial 3 Excursion**: `PENDING`
- **Mean ROM**: `PENDING`
- **CV%**: `PENDING`
- **Verdict**: `PENDING`

### Protocol 4: Shoulder Abduction (Left / Right)
- **Required View**: `FRONTAL`
- **Target Joint**: `leftShoulderAbd` / `rightShoulderAbd`
- **Trial 1 Excursion**: `PENDING`
- **Trial 2 Excursion**: `PENDING`
- **Trial 3 Excursion**: `PENDING`
- **Mean ROM**: `PENDING`
- **CV%**: `PENDING`
- **Verdict**: `PENDING`

### Protocol 5: Elbow Flexion
- **Required View**: `LEFT_SAGITTAL` / `RIGHT_SAGITTAL`
- **Target Joint**: `leftElbow` / `rightElbow`
- **Trial 1 Excursion**: `PENDING`
- **Trial 2 Excursion**: `PENDING`
- **Trial 3 Excursion**: `PENDING`
- **Mean ROM**: `PENDING`
- **CV%**: `PENDING`
- **Verdict**: `PENDING`

### Protocol 6: Squat (Bilateral)
- **Required View**: `SAGITTAL`
- **Target Joints**: `leftKnee`, `rightKnee`
- **Reps Target**: 5 reps
- **Trial 1 Peak / Excursion**: `PENDING`
- **Trial 2 Peak / Excursion**: `PENDING`
- **Symmetry Ratio**: `PENDING`
- **Verdict**: `PENDING`

### Protocol 7: Sit-to-Stand (Bilateral)
- **Required View**: `SAGITTAL`
- **Target Joints**: `leftKnee`, `rightKnee`
- **Reps Target**: 5 reps
- **Trial 1 Peak / Excursion**: `PENDING`
- **Trial 2 Peak / Excursion**: `PENDING`
- **Symmetry Ratio**: `PENDING`
- **Verdict**: `PENDING`

---

## 4. Performance & Telemetry Targets

| Metric | Target Budget | Measured on `soooren` | Status |
| :--- | :--- | :--- | :--- |
| **Inference Rate** | ≥ 25 fps | `PENDING` | PENDING |
| **Render Rate** | ≥ 50 fps | `PENDING` | PENDING |
| **Landmark Visibility Ratio** | ≥ 80% on target limb | `PENDING` | PENDING |
| **Filter Latency / Lag** | ≤ 45 ms | `PENDING` | PENDING |
| **Suspension Responsiveness** | < 100 ms on occlusion | `PENDING` | PENDING |

---

## 5. Summary & Sign-off

- **Hardware**: Validated host `soooren` (Alienware m18 R2, Windows 11).
- **Camera Configuration**: Single monocular RGB (`Integrated Webcam RGB`). `Integrated IR` confirmed excluded from viewpoint pipelines.
- **Trial Data**: Physical measurements marked `PENDING` pending protocol trials via `?soloValidate=1`.
- **Clinical Readiness**: **NOT READY FOR CLINICAL USE** (`Clinical accuracy: NO`). Public Research Preview only.
