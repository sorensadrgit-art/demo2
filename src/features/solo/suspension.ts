export type SuspensionReason =
  | 'TARGET_NOT_VISIBLE'
  | 'WRONG_VIEW'
  | 'PATIENT_TOO_SMALL'
  | 'PATIENT_TOO_CLOSE'
  | 'JOINT_CLIPPED'
  | 'POSE_UNSTABLE'
  | 'PATIENT_IDENTITY_AMBIGUOUS'
  | 'CAMERA_LOST'
  | 'LOW_FRAME_RATE'
  | 'EXCESSIVE_OUT_OF_PLANE_MOTION'
  | 'LANDMARK_OCCLUDED'
  | 'NO_SUBJECT_SELECTED';

export const SUSPENSION_COPY: Record<SuspensionReason, string> = {
  TARGET_NOT_VISIBLE: 'Target joint is not visible',
  WRONG_VIEW: 'Turn to the required camera plane',
  PATIENT_TOO_SMALL: 'Move closer',
  PATIENT_TOO_CLOSE: 'Move back',
  JOINT_CLIPPED: 'Keep the full target limb in frame',
  POSE_UNSTABLE: 'Hold still until tracking is stable',
  PATIENT_IDENTITY_AMBIGUOUS: 'Clear extra people from the frame',
  CAMERA_LOST: 'Camera unavailable — retry camera',
  LOW_FRAME_RATE: 'Camera frame rate is too low',
  EXCESSIVE_OUT_OF_PLANE_MOTION: 'Stay in the required plane of motion',
  LANDMARK_OCCLUDED: 'Uncover the target joint',
  NO_SUBJECT_SELECTED: 'Step into the measurement position',
};

export function coachCue(reason: SuspensionReason | null): string | null {
  if (!reason) return null;
  return SUSPENSION_COPY[reason];
}
