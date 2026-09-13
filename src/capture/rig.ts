import type { AcquisitionGrade } from '../measurement/domain';

/**
 * Hardware-agnostic capture-rig abstraction (Phases 3-4).
 * Vendor adapters (Qualisys/FLIR/Sony/phone/webcam) plug in here;
 * KineLab core never hardcodes a device brand.
 */
export interface CameraCapabilities {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  shutterType?: 'global' | 'rolling' | 'unknown';
  syncMode: 'hardware' | 'ptp' | 'software' | 'unsynchronized';
  supportsManualExposure: boolean;
  supportsManualFocus: boolean;
}

export interface CaptureRig {
  id: string;
  grade: AcquisitionGrade;
  cameras: CameraCapabilities[];
  calibrationId?: string;
  synchronized: boolean;
  captureRateHz: number;
}

/** Reference configuration profiles (engineering QA parameters). */
export const PRECISION_RIG_PROFILE: Omit<CaptureRig, 'id' | 'calibrationId'> = {
  grade: 'precision',
  cameras: [],
  synchronized: true,
  captureRateHz: 120,
};

export const PRECISION_CAMERA_SPEC: Pick<CameraCapabilities, 'width' | 'height' | 'fps' | 'syncMode' | 'supportsManualExposure' | 'supportsManualFocus'> = {
  width: 1920,
  height: 1080,
  fps: 120,
  syncMode: 'hardware',
  supportsManualExposure: true,
  supportsManualFocus: true,
};

export const PRECISION_CAMERA_COUNT = { min: 6, max: 8 };

export const CLINICAL_RIG_PROFILE = {
  grade: 'clinical' as const,
  cameraCount: { min: 2, max: 3 },
  minFps: 60,
  synchronized: true,
  calibrated: true,
};

export const SOLO_RIG_PROFILE = {
  grade: 'solo' as const,
  cameraCount: 1,
  note: 'Current webcam/video pipeline; calibration/plane gates remain active; lower measurement grade.',
};

/** Build a rig descriptor from a camera list (pure, testable). */
export function buildRig(
  id: string,
  grade: AcquisitionGrade,
  cameras: CameraCapabilities[],
  calibrationId?: string,
): CaptureRig {
  const syncModes = new Set(cameras.map((c) => c.syncMode));
  const synchronized = cameras.length > 1
    ? !syncModes.has('unsynchronized')
    : true;
  const captureRateHz = cameras.length
    ? Math.min(...cameras.map((c) => c.fps))
    : 0;
  return { id, grade, cameras, calibrationId, synchronized, captureRateHz };
}

/** Solo rig for the current single-camera pipeline. */
export function soloRig(cameraId = 'cam-solo-01', width = 1280, height = 720, fps = 60): CaptureRig {
  return buildRig('rig-solo', 'solo', [{
    id: cameraId,
    label: 'Solo camera',
    width,
    height,
    fps,
    shutterType: 'unknown',
    syncMode: 'unsynchronized',
    supportsManualExposure: false,
    supportsManualFocus: false,
  }]);
}
