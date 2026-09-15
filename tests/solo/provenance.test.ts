import { describe, expect, it } from 'vitest';
import {
  SOLO_PIPELINE_VERSION,
  classifyCameraLabel,
  makeSoloProvenance,
  pickRgbCamera,
} from '../../src/features/solo/provenance';
import { KNEE_FLEXION_CONVENTION } from '../../src/features/solo/clinicalAngle';

function baseProvenance() {
  return makeSoloProvenance({
    sessionId: 'sess-1',
    protocol: 'knee-flexion',
    targetSide: 'left',
    cameraId: 'cam-1',
    width: 1280,
    height: 720,
    fps: 30,
    convention: KNEE_FLEXION_CONVENTION,
    viewClassification: 'LEFT_SAGITTAL',
    viewQuality: 'VIEW_GOOD',
    qualityState: 'VALID',
    startFrame: 10,
    endFrame: 100,
  });
}

describe('makeSoloProvenance', () => {
  it('stamps acquisitionGrade solo, 2d-screen-plane, not triangulated, not calibrated', () => {
    const p = baseProvenance();
    expect(p.acquisitionGrade).toBe('solo');
    expect(p.dimensionality).toBe('2d-screen-plane');
    expect(p.triangulated).toBe(false);
    expect(p.calibrated).toBe(false);
    expect(p.cameraCount).toBe(1);
    expect(p.source).toBe('camera');
    expect(p.opensim).toBe(false);
  });

  it('carries session, protocol, side, camera and frame range', () => {
    const p = baseProvenance();
    expect(p.sessionId).toBe('sess-1');
    expect(p.protocol).toBe('knee-flexion');
    expect(p.targetSide).toBe('left');
    expect(p.cameraId).toBe('cam-1');
    expect(p.resolution).toEqual({ width: 1280, height: 720 });
    expect(p.fps).toBe(30);
    expect(p.startFrame).toBe(10);
    expect(p.endFrame).toBe(100);
  });

  it('defaults the build version to the solo pipeline version', () => {
    expect(baseProvenance().buildVersion).toBe(SOLO_PIPELINE_VERSION);
    expect(baseProvenance().buildVersion).toContain('kinelab-solo-webcam');
  });

  it('embeds the clinical angle definition, not a raw number', () => {
    const p = baseProvenance();
    expect(p.angleDefinition).toContain('180 - interior');
    expect(p.angleDefinition).toContain(KNEE_FLEXION_CONVENTION.id);
  });

  it('records the landmark schema and pose provider', () => {
    const p = baseProvenance();
    expect(p.landmarkSchema).toBe('mediapipe-33');
    expect(p.poseProvider).toBe('MediaPipePoseProvider');
    expect(p.poseProviderVersion).toContain('pose_landmarker');
  });
});

describe('classifyCameraLabel', () => {
  it('recognises IR cameras', () => {
    expect(classifyCameraLabel('Kinect IR Camera')).toBe('ir');
    expect(classifyCameraLabel('Azure Kinect Infrared Depth')).toBe('ir');
  });

  it('recognises virtual cameras', () => {
    expect(classifyCameraLabel('OBS Virtual Camera')).toBe('virtual');
    expect(classifyCameraLabel('DroidCam Source')).toBe('virtual');
  });

  it('recognises ordinary RGB webcams', () => {
    expect(classifyCameraLabel('Integrated Webcam')).toBe('rgb');
    expect(classifyCameraLabel('Logitech HD Pro Webcam C920')).toBe('rgb');
  });

  it('returns unknown for unrecognisable labels', () => {
    expect(classifyCameraLabel('')).toBe('unknown');
    expect(classifyCameraLabel('Device 04f2:b6aa')).toBe('unknown');
  });
});

describe('pickRgbCamera', () => {
  it('skips IR-labelled cameras', () => {
    const id = pickRgbCamera([
      { deviceId: 'ir-1', label: 'Kinect IR Camera' },
      { deviceId: 'rgb-1', label: 'Logitech Webcam C930e' },
    ]);
    expect(id).toBe('rgb-1');
  });

  it('skips virtual cameras too', () => {
    const id = pickRgbCamera([
      { deviceId: 'virt-1', label: 'OBS Virtual Camera' },
      { deviceId: 'rgb-2', label: 'USB Camera' },
    ]);
    expect(id).toBe('rgb-2');
  });

  it('prefers an integrated webcam over other RGB devices', () => {
    const id = pickRgbCamera([
      { deviceId: 'rgb-usb', label: 'USB Video Camera' },
      { deviceId: 'rgb-int', label: 'Integrated Webcam' },
    ]);
    expect(id).toBe('rgb-int');
  });

  it('returns empty string when only IR or unknown devices exist', () => {
    expect(pickRgbCamera([{ deviceId: 'ir-1', label: 'IR Camera' }])).toBe('');
    expect(pickRgbCamera([])).toBe('');
    expect(pickRgbCamera([{ deviceId: 'u1', label: 'zzzz' }])).toBe('');
  });
});
