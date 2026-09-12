// Rules-based compensation engine. Every flag carries supporting
// measurement evidence — never vague "form looks bad" statements.
export interface CompensationEvidence {
  metric: string;
  value: number;
  threshold: number;
  unit: string;
}

export interface CompensationFlag {
  id: string;
  label: string;
  detail: string;
  severity: 'info' | 'watch' | 'high';
  confidence: 'Low' | 'Moderate' | 'High';
  evidence: CompensationEvidence[];
  timestamp: number;
}

export interface CompensationInputs {
  trunkLateralDeg: number; // |lateral lean|
  trunkFlexDeg: number; // deviation from upright
  leftKneeDeg: number; rightKneeDeg: number;
  leftHipDeg: number; rightHipDeg: number;
  pelvisShiftNorm: number; // lateral pelvis displacement / shoulder width
  trunkValid: boolean;
  kneeValid: boolean;
  t: number;
}

export function detectCompensations(i: CompensationInputs): CompensationFlag[] {
  const flags: CompensationFlag[] = [];
  if (i.trunkValid && Math.abs(i.trunkLateralDeg) > 10) {
    flags.push({
      id: 'trunk-lateral', label: 'TRUNK COMPENSATION DETECTED',
      detail: `Peak lateral trunk lean: ${Math.abs(i.trunkLateralDeg).toFixed(1)}°`,
      severity: Math.abs(i.trunkLateralDeg) > 15 ? 'high' : 'watch',
      confidence: 'High',
      evidence: [{ metric: 'Peak lateral trunk lean', value: Math.abs(i.trunkLateralDeg), threshold: 10, unit: '°' }],
      timestamp: i.t,
    });
  }
  if (i.trunkValid && Math.abs(i.trunkFlexDeg) > 25) {
    flags.push({
      id: 'trunk-flex', label: 'EXCESSIVE TRUNK STRATEGY',
      detail: `Trunk flexion deviation: ${Math.abs(i.trunkFlexDeg).toFixed(1)}°`,
      severity: 'watch', confidence: 'Moderate',
      evidence: [{ metric: 'Trunk flexion deviation', value: Math.abs(i.trunkFlexDeg), threshold: 25, unit: '°' }],
      timestamp: i.t,
    });
  }
  if (i.kneeValid && Number.isFinite(i.leftKneeDeg) && Number.isFinite(i.rightKneeDeg)) {
    const asym = Math.abs(i.leftKneeDeg - i.rightKneeDeg);
    if (asym > 12) {
      flags.push({
        id: 'asymmetric-depth', label: 'LEFT-RIGHT ASYMMETRY',
        detail: `Inter-limb difference: ${asym.toFixed(1)}°`,
        severity: asym > 20 ? 'high' : 'watch', confidence: 'High',
        evidence: [{ metric: 'Inter-limb angle difference', value: asym, threshold: 12, unit: '°' }],
        timestamp: i.t,
      });
    }
  }
  if (Number.isFinite(i.pelvisShiftNorm) && i.pelvisShiftNorm > 0.12) {
    flags.push({
      id: 'pelvic-shift', label: 'PELVIC SHIFT DETECTED',
      detail: `Lateral pelvis shift: ${(i.pelvisShiftNorm * 100).toFixed(1)}% of shoulder width`,
      severity: 'watch', confidence: 'Moderate',
      evidence: [{ metric: 'Pelvis shift ratio', value: i.pelvisShiftNorm, threshold: 0.12, unit: 'ratio' }],
      timestamp: i.t,
    });
  }
  return flags;
}
