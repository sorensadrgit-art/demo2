"""Typed domain errors. Expected scientific failures are structured values,
never generic 500s."""
from __future__ import annotations


class BiomechanicsError(Exception):
    code: str = "UNKNOWN"
    message: str = "unknown error"

    def __init__(self, message: str = "", **detail):
        super().__init__(message or self.message)
        self.detail = detail

    def to_dict(self) -> dict:
        return {"code": self.code, "message": str(self), "detail": self.detail}


class CalibrationInsufficientImages(BiomechanicsError):
    code = "CALIBRATION_INSUFFICIENT_IMAGES"


class CalibrationBadCoverage(BiomechanicsError):
    code = "CALIBRATION_BAD_COVERAGE"


class CalibrationHighReprojectionError(BiomechanicsError):
    code = "CALIBRATION_HIGH_REPROJECTION_ERROR"


class CameraNotCalibrated(BiomechanicsError):
    code = "CAMERA_NOT_CALIBRATED"


class FrameSyncInvalid(BiomechanicsError):
    code = "FRAME_SYNC_INVALID"


class InsufficientViews(BiomechanicsError):
    code = "INSUFFICIENT_VIEWS"


class TriangulationDegenerate(BiomechanicsError):
    code = "TRIANGULATION_DEGENERATE"


class TriangulationHighReprojectionError(BiomechanicsError):
    code = "TRIANGULATION_HIGH_REPROJECTION_ERROR"


class PoseProviderUnavailable(BiomechanicsError):
    code = "POSE_PROVIDER_UNAVAILABLE"


class PoseInferenceFailed(BiomechanicsError):
    code = "POSE_INFERENCE_FAILED"


class BiomechanicalModelUnavailable(BiomechanicsError):
    code = "BIOMECHANICAL_MODEL_UNAVAILABLE"


class IKSolveFailed(BiomechanicsError):
    code = "IK_FAILED"


class IKHighResidual(BiomechanicsError):
    code = "IK_HIGH_RESIDUAL"


class CaptureBundleInvalid(BiomechanicsError):
    code = "CAPTURE_BUNDLE_INVALID"


class CaptureChecksumMismatch(BiomechanicsError):
    code = "CAPTURE_CHECKSUM_MISMATCH"


class CaptureCameraMissing(BiomechanicsError):
    code = "CAPTURE_CAMERA_MISSING"


class CaptureTimestampMismatch(BiomechanicsError):
    code = "CAPTURE_TIMESTAMP_MISMATCH"


class CaptureNotSynchronized(BiomechanicsError):
    code = "CAPTURE_NOT_SYNCHRONIZED"


class CaptureCalibrationMismatch(BiomechanicsError):
    code = "CAPTURE_CALIBRATION_MISMATCH"


class CaptureTooFewCameras(BiomechanicsError):
    code = "CAPTURE_TOO_FEW_CAMERAS"
