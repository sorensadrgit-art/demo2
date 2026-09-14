# KineLab Pose-Provider Replacement (commercial-licensing readiness)

Precision depends only on the `PoseBenchmarkProvider` interface
(`services/biomechanics/app/pose_providers.py`): `infer(frame, roi) ->
BenchmarkPose` with KineLab semantic landmark ids, pixel coordinates, raw
confidence, and provider metadata. Selection is via
`KINELAB_PRECISION_POSE_PROVIDER`; no pipeline code hardwires RTMW class
names.

## To introduce a commercially compatible provider

1. Implement `PoseBenchmarkProvider` for the candidate (2D whole-body
   landmarks + confidence + 256×192-or-better geometry contract).
2. Serve it behind the same worker HTTP shape (`providers_rtmw.py` is the
   reference adapter) on an internal port.
3. Re-run the V5.5 benchmark battery (`resolution_compare.py`,
   `realimage_probe.py`, `temporal_ramp.py`, `test_perception_v55.py`)
   through the common schema and record results in
   `artifacts/perception-v55-results.json` successor.
4. Re-run V5.6 identity + precision suites; the provider must pass the same
   suspension-vs-guess gates before selection default changes.
5. Update the model manifest (source, SHA-256, license, commercial status)
   and `THIRD_PARTY_NOTICES.md`.

RTMW is NOT replaced in R1: no candidate has passed this validation, and
release infrastructure stays provider-agnostic so the swap needs no rework.
