import type { AcquisitionGrade } from '../../measurement/domain';
import type { SoloViewClass, ViewQuality } from './viewClassifier';
import type { SoloQualityState } from './qualityEngine';
import type { ClinicalConvention } from './clinicalAngle';
import { conventionDescription } from './clinicalAngle';

export const SOLO_PIPELINE_VERSION = 'kinelab-solo-webcam/6.3';
export const SOLO_FILTER_VERSION = 'one-euro/1.2-0.02-1.0';
export const SOLO_POSE_PROVIDER = 'MediaPipePoseProvider';
export const SOLO_POSE_PROVIDER_VERSION = 'tasks-vision@0.10.20/pose_landmarker_full';
export const SOLO_LANDMARK_SCHEMA = 'mediapipe-33';

export interface SoloProvenance {
  sessionId: string;
  protocol: string;
  targetSide: 'left' | 'right';
  cameraId: string;
  resolution: { width: number; height: number };
  fps: number;
  poseProvider: string;
  poseProviderVersion: string;
  landmarkSchema: string;
  angleDefinition: string;
  filterVersion: string;
  viewClassification: SoloViewClass;
  viewQuality: ViewQuality;
  qualityState: SoloQualityState;
  startFrame: number;
  endFrame: number;
  buildVersion: string;
  acquisitionGrade: AcquisitionGrade;
  dimensionality: '2d-screen-plane';
  source: 'camera';
  cameraCount: 1;
  calibrated: false;
  triangulated: false;
  opensim: false;
}

export function makeSoloProvenance(p: {
  sessionId: string;
  protocol: string;
  targetSide: 'left' | 'right';
  cameraId: string;
  width: number;
  height: number;
  fps: number;
  convention: ClinicalConvention;
  viewClassification: SoloViewClass;
  viewQuality: ViewQuality;
  qualityState: SoloQualityState;
  startFrame: number;
  endFrame: number;
  buildVersion?: string;
}): SoloProvenance {
  return {
    sessionId: p.sessionId,
    protocol: p.protocol,
    targetSide: p.targetSide,
    cameraId: p.cameraId,
    resolution: { width: p.width, height: p.height },
    fps: p.fps,
    poseProvider: SOLO_POSE_PROVIDER,
    poseProviderVersion: SOLO_POSE_PROVIDER_VERSION,
    landmarkSchema: SOLO_LANDMARK_SCHEMA,
    angleDefinition: conventionDescription(p.convention),
    filterVersion: SOLO_FILTER_VERSION,
    viewClassification: p.viewClassification,
    viewQuality: p.viewQuality,
    qualityState: p.qualityState,
    startFrame: p.startFrame,
    endFrame: p.endFrame,
    buildVersion: p.buildVersion ?? SOLO_PIPELINE_VERSION,
    acquisitionGrade: 'solo',
    dimensionality: '2d-screen-plane',
    source: 'camera',
    cameraCount: 1,
    calibrated: false,
    triangulated: false,
    opensim: false,
  };
}

export function classifyCameraLabel(label: string): 'rgb' | 'ir' | 'virtual' | 'unknown' {
  const s = label.toLowerCase();
  if (/\bir\b|infrared/.test(s)) return 'ir';
  if (/obs|virtual|droidcam|manycam|snap/.test(s)) return 'virtual';
  if (/webcam|rgb|camera|integrated/.test(s)) return 'rgb';
  return 'unknown';
}

export function pickRgbCamera(devices: Array<{ deviceId: string; label: string }>): string | '' {
  const rgb = devices.filter((d) => classifyCameraLabel(d.label) === 'rgb');
  const integrated = rgb.find((d) => /integrated webcam/i.test(d.label) && !/\bir\b/i.test(d.label));
  return (integrated ?? rgb[0])?.deviceId ?? '';
}
