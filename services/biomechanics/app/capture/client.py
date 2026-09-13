"""KineLab capture workstation reference client (V6.1 Phase 17).

Generic interface for a PHYSICAL CAPTURE WORKSTATION. No vendor-specific
integrations are built or tested here — this specifies the contract an
external rig (Qualisys/Vicon/machine-vision/...) adapts to, with
file-import mode (recordings + timestamps + calibration) as the first
production path (Phase 18).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

SyncMethod = Literal[
    "HARDWARE_TRIGGER", "PTP", "GENLOCK", "SHARED_CLOCK",
    "SOFTWARE_SYNC", "UNSYNCHRONIZED",
]


@dataclass
class CameraMetadata:
    camera_id: str
    manufacturer: str | None = None
    model: str | None = None
    serial: str | None = None
    width: int | None = None
    height: int | None = None
    frame_rate_hz: float | None = None
    pixel_format: str | None = None
    shutter_type: str | None = None
    exposure: str | None = None
    gain: str | None = None
    focus_state: str | None = None
    interface: str | None = None


@dataclass
class CapturedFrame:
    camera_id: str
    frame_index: int
    monotonic_ns: int
    hardware_ns: int | None
    rgb: object = None  # BGR ndarray when read with decode=True
    source_path: str = ""


class CameraSource(Protocol):
    """One physical camera stream on the capture workstation."""

    camera_id: str

    def read_frame(self, frame_index: int,
                   decode: bool = True) -> CapturedFrame:
        """Return frame `frame_index` with its exact timestamp."""
        ...

    def timestamp(self, frame_index: int) -> tuple[int, int | None]:
        """(monotonic_ns, hardware_ns|None) for `frame_index`."""
        ...

    def metadata(self) -> CameraMetadata:
        """Physical camera metadata; unknown fields are None."""
        ...

    def frame_count(self) -> int:
        ...


class SyncSource(Protocol):
    """Workstation-level synchronization evidence."""

    synchronization_method: SyncMethod

    def start_spread_ms(self) -> float:
        """Max camera start-timestamp spread in ms."""
        ...

    def is_precision_eligible(self) -> bool:
        """Declared method is synchronizing AND spread within tolerance."""
        ...


@dataclass
class FileCameraSource:
    """File-import CameraSource: video file or frames/ dir + timestamps.csv.

    This is the Phase-18 production path: recordings produced by external
    camera software, read deterministically by frame index.
    """
    camera_id: str
    recording: str  # video file or frames/ directory
    timestamps_csv: str
    meta: CameraMetadata = field(default_factory=lambda: CameraMetadata(
        camera_id=""))
    _rows: list[dict] | None = field(default=None, repr=False)

    def _timestamps(self) -> list[dict]:
        if self._rows is None:
            import sys
            sys.path.insert(0, str(
                __import__("pathlib").Path(__file__).resolve().parents[2]))
            from app.capture.bundle import read_timestamps_ns
            self._rows = read_timestamps_ns(
                __import__("pathlib").Path(self.timestamps_csv))
        return self._rows

    def read_frame(self, frame_index: int,
                   decode: bool = True) -> CapturedFrame:
        import sys
        sys.path.insert(0, str(
            __import__("pathlib").Path(__file__).resolve().parents[2]))
        from app.capture.bundle import decode_frame_bgr
        rows = self._timestamps()
        row = next(r for r in rows if r["frameIndex"] == frame_index)
        rgb = (decode_frame_bgr(
            __import__("pathlib").Path(self.recording), frame_index)
            if decode else None)
        return CapturedFrame(
            camera_id=self.camera_id, frame_index=frame_index,
            monotonic_ns=row["monoNs"], hardware_ns=row["hwNs"],
            rgb=rgb, source_path=self.recording)

    def timestamp(self, frame_index: int) -> tuple[int, int | None]:
        rows = self._timestamps()
        row = next(r for r in rows if r["frameIndex"] == frame_index)
        return row["monoNs"], row["hwNs"]

    def metadata(self) -> CameraMetadata:
        if not self.meta.camera_id:
            self.meta.camera_id = self.camera_id
        return self.meta

    def frame_count(self) -> int:
        return len(self._timestamps())
