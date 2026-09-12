import { create } from 'zustand';
import type { PatientCue } from './protocols';
import type { FocusPhase, FocusTrial } from './focusMachine';

/**
 * Focus Mode orchestration state. Owns workflow only — never biomechanics.
 * All angles/velocities/confidence are read from useSession + frameStore.
 */
interface FocusState {
  /** Focus vs Advanced(Lab) experience layer. */
  experience: 'focus' | 'lab';
  phase: FocusPhase;
  protocolId: string | null;
  side: 'left' | 'right';
  trialIndex: number;
  trials: FocusTrial[];
  bestIndex: number | null;
  bestReason: string | null;
  cue: PatientCue;
  statusMessage: string | null;
  blockers: string[];
  autoRecoveries: number;
  retakes: number;
  manualOverrides: number;
  phaseStartedAt: number;
  protocolStartedAt: number;
  readyAt: number | null;
  savedVisitId: string | null;
  /** Clinician acknowledged ambiguous-target selection is required. */
  needsTap: boolean;
  /** Manual override: clinician asked to start the trial window now. */
  manualStartRequested: boolean;
  set: (p: Partial<FocusState>) => void;
  reset: () => void;
  beginAssessment: (protocolId: string, side: 'left' | 'right') => void;
}

export const useFocus = create<FocusState>((set) => ({
  experience: 'focus',
  phase: 'patient',
  protocolId: null,
  side: 'left',
  trialIndex: 0,
  trials: [],
  bestIndex: null,
  bestReason: null,
  cue: null,
  statusMessage: null,
  blockers: [],
  autoRecoveries: 0,
  retakes: 0,
  manualOverrides: 0,
  phaseStartedAt: Date.now(),
  protocolStartedAt: 0,
  readyAt: null,
  savedVisitId: null,
  needsTap: false, manualStartRequested: false,
  set: (p) => set({ ...p, phaseStartedAt: p.phase ? Date.now() : undefined } as Partial<FocusState>),
  reset: () => set({
    phase: 'patient', protocolId: null, trialIndex: 0, trials: [],
    bestIndex: null, bestReason: null, cue: null, statusMessage: null,
    blockers: [], retakes: 0, savedVisitId: null, needsTap: false, manualStartRequested: false,
    protocolStartedAt: 0, readyAt: null,
  }),
  beginAssessment: (protocolId, side) => set({
    protocolId, side, phase: 'setup', trialIndex: 0, trials: [],
    bestIndex: null, bestReason: null, cue: null, statusMessage: null,
    blockers: [], retakes: 0, savedVisitId: null, needsTap: false, manualStartRequested: false,
    protocolStartedAt: Date.now(), phaseStartedAt: Date.now(), readyAt: null,
  }),
}));

/** Therapist interaction + timing instrumentation (P-attention metrics). */
export function focusMetrics() {
  const f = useFocus.getState();
  return {
    trials: f.trials.length,
    retakes: f.retakes,
    autoRecoveries: f.autoRecoveries,
    manualOverrides: f.manualOverrides,
    timeToReadyMs: f.readyAt && f.protocolStartedAt ? f.readyAt - f.protocolStartedAt : null,
  };
}
