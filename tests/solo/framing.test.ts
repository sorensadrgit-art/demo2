import { describe, expect, it } from 'vitest';
import { LM } from '../../src/features/pose/poseTypes';
import { assessFraming } from '../../src/features/solo/framing';
import { makeLandmarks, setLm } from './helpers';

const W = 640;
const H = 480;

/** Left leg nicely framed mid-screen with a reasonable bounding-box height.
 *  The knee is offset in x so the pose bounding box is non-degenerate. */
function wellFramedLeft() {
  const lms = makeLandmarks();
  setLm(lms, LM.leftHip, 0.5, 0.3);
  setLm(lms, LM.leftKnee, 0.45, 0.55);
  setLm(lms, LM.leftAnkle, 0.5, 0.8);
  return lms;
}

describe('assessFraming — accepted framing', () => {
  it('accepts a fully visible, mid-frame left leg', () => {
    const r = assessFraming(wellFramedLeft(), 'left', W, H);
    expect(r.requiredVisible).toBe(true);
    expect(r.clipped).toBe(false);
    expect(r.tooSmall).toBe(false);
    expect(r.tooClose).toBe(false);
    expect(r.reason).toBeNull();
    expect(r.cue).toBeNull();
  });

  it('reports the hip-to-ankle segment length in pixels', () => {
    const r = assessFraming(wellFramedLeft(), 'left', W, H);
    expect(r.segmentLengthPx).toBeCloseTo(240, 6); // 0.5 * 480
    expect(r.bboxHeight).toBeGreaterThan(0.28);
  });
});

describe('assessFraming — target visibility', () => {
  it('suspends with LANDMARK_OCCLUDED when a required joint is essentially invisible', () => {
    const lms = wellFramedLeft();
    setLm(lms, LM.leftAnkle, 0.5, 0.8, 0.1);
    const r = assessFraming(lms, 'left', W, H);
    expect(r.requiredVisible).toBe(false);
    expect(r.reason).toBe('LANDMARK_OCCLUDED');
    expect(r.cue).toBe('Show full left leg');
  });

  it('suspends with TARGET_NOT_VISIBLE when a joint is present but too faint', () => {
    const lms = wellFramedLeft();
    setLm(lms, LM.leftKnee, 0.5, 0.55, 0.2);
    const r = assessFraming(lms, 'left', W, H);
    expect(r.requiredVisible).toBe(false);
    expect(r.reason).toBe('TARGET_NOT_VISIBLE');
    expect(r.cue).toBe('Show full left leg');
  });

  it('checks the right leg when side is right', () => {
    const lms = makeLandmarks();
    setLm(lms, LM.rightHip, 0.5, 0.3, 0.9);
    setLm(lms, LM.rightKnee, 0.5, 0.55, 0.9);
    setLm(lms, LM.rightAnkle, 0.5, 0.8, 0.1); // occluded
    const r = assessFraming(lms, 'right', W, H);
    expect(r.reason).toBe('LANDMARK_OCCLUDED');
    expect(r.cue).toBe('Show full right leg');
  });
});

describe('assessFraming — geometry problems', () => {
  it('suspends with JOINT_CLIPPED when a required joint is at the frame edge', () => {
    const lms = wellFramedLeft();
    setLm(lms, LM.leftAnkle, 0.01, 0.8, 0.9);
    const r = assessFraming(lms, 'left', W, H);
    expect(r.requiredVisible).toBe(true);
    expect(r.clipped).toBe(true);
    expect(r.reason).toBe('JOINT_CLIPPED');
    expect(r.cue).toBe('Keep ankle visible');
  });

  it('suspends with PATIENT_TOO_SMALL when the body bounding box is tiny', () => {
    const lms = makeLandmarks();
    setLm(lms, LM.leftHip, 0.5, 0.45, 0.9);
    setLm(lms, LM.leftKnee, 0.48, 0.5, 0.9);
    setLm(lms, LM.leftAnkle, 0.5, 0.55, 0.9);
    const r = assessFraming(lms, 'left', W, H);
    expect(r.bboxHeight).toBeLessThan(0.28);
    expect(r.reason).toBe('PATIENT_TOO_SMALL');
    expect(r.cue).toBe('Move closer');
  });

  it('suspends with PATIENT_TOO_CLOSE when the body fills the frame', () => {
    const lms = makeLandmarks();
    setLm(lms, LM.leftHip, 0.5, 0.04, 0.9);
    setLm(lms, LM.leftKnee, 0.48, 0.5, 0.9);
    setLm(lms, LM.leftAnkle, 0.5, 0.96, 0.9);
    const r = assessFraming(lms, 'left', W, H);
    expect(r.clipped).toBe(false);
    expect(r.tooClose).toBe(true);
    expect(r.reason).toBe('PATIENT_TOO_CLOSE');
    expect(r.cue).toBe('Move back');
  });
});
