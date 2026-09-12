import { useEffect, useRef } from 'react';
import { useSession } from '../../stores/sessionStore';
import { usePatients } from '../../stores/patientStore';
import { useUI } from '../../stores/uiStore';
import { frameStore } from '../visualization/frameStore';
import { engineRefs } from '../capture/useMotionEngine';
import { sessionClock } from '../../lib/timing/timeSync';
import { assessCalibrationQuality, captureReference } from '../calibration/calibrationEngine';
import { checkFraming } from '../calibration/cameraAlignment';
import { assessCameraView } from '../biomechanics/anatomicalPlanes';
import { JOINT_DEFS } from '../biomechanics/jointAngles';
import { summarizeTrial } from '../biomechanics/movementMetrics';
import { getProtocol, primaryJoint, resolveJoints, type PatientCue } from './protocols';
import { useFocus } from './focusStore';
import {
  canEnterReady, evaluateTrialQuality, selectBestTrial, trialNeedsRetake,
  OnsetDetector, CompletionDetector, CycleCounter,
} from './focusMachine';

interface ActiveTrial {
  startT: number;
  startAngle: number;
  samples: Array<{ t: number; angle: number; vel: number }>;
  validCount: number;
  totalCount: number;
  occludedCount: number;
  viewSum: number;
  viewCount: number;
  confSum: number;
}

/** Map a framing/plane/calibration condition to one actionable therapist cue. */
function cueFor(blockers: string[], viewGuidance: string | null): { cue: PatientCue; message: string } | null {
  const b = blockers.join(' ');
  if (/NO SUBJECT|NOT VISIBLE/.test(b)) return { cue: 'step-into-frame', message: 'Step into the frame.' };
  if (/TOO CLOSE|TOO FAR|FEET OUT|HEAD OUT/.test(b)) return { cue: 'step-back', message: 'Step one step backward.' };
  if (/OFF-CENTER|CENTER PATIENT/.test(b)) return { cue: 'center-patient', message: 'Center the patient in frame.' };
  if (/SIDE VIEW|SIDE/.test(b) || /TURN PATIENT/.test(viewGuidance ?? '')) {
    return { cue: 'turn-sideways', message: 'Turn sideways to the camera.' };
  }
  if (/FRONT/.test(viewGuidance ?? '')) return { cue: 'turn-front', message: 'Face the camera.' };
  if (/ANKLE|KNEE|SHOULDER|HIP|OCCLUDED/.test(b)) return { cue: 'center-patient', message: `${blockers[0].charAt(0)}${blockers[0].slice(1).toLowerCase()}.` };
  return null;
}

/**
 * Focus automation: polls live engine state (~5 Hz) and advances the
 * orchestration machine. AUTOMATIC WHEN CONFIDENT, ASK WHEN AMBIGUOUS,
 * STOP WHEN UNSAFE, ALLOW OVERRIDE.
 */
export function useFocusAutomation() {
  const active = useRef<ActiveTrial | null>(null);
  const onset = useRef(new OnsetDetector());
  const completion = useRef(new CompletionDetector());
  const cycles = useRef(new CycleCounter());
  const countdown = useRef<{ t0: number; n: number } | null>(null);
  const lastPhase = useRef('');

  useEffect(() => {
    const id = setInterval(() => {
      const f = useFocus.getState();
      if (f.experience !== 'focus' || !f.protocolId) return;
      const p = getProtocol(f.protocolId);
      if (!p) return;
      const st = useSession.getState();
      const joint = primaryJoint(p, f.side);
      const lms = frameStore.landmarks;
      const now = sessionClock.now();

      const set = (patch: Parameters<typeof f.set>[0]) => useFocus.getState().set(patch);
      const phaseKey = `${f.phase}:${f.trialIndex}`;
      void phaseKey;

      // ---------- SETUP: configure the existing engines automatically ----------
      if (f.phase === 'setup') {
        const patient = usePatients.getState().activePatient();
        const sessionPatch = {
          session: {
            ...st.session,
            patientId: patient.id,
            movementId: p.movementId,
            cameraPlane: p.preferredPlane,
            affectedSide: p.affectedSideRequired ? (f.side as 'left' | 'right') : patient.affectedSide,
            startedAt: f.protocolStartedAt || Date.now(),
          },
          activeJoint: joint,
          trials: [],
          compensations: [],
        };
        st.set(sessionPatch);
        frameStore.activeJoint = joint;
        // Protocol overlays determine the canvas treatment.
        useUI.getState().set({
          showTrails: p.overlays.includes('trails'),
          showVectors: false,
          showCOM: p.overlays.includes('com'),
        });
        onset.current.reset();
        completion.current.reset();
        cycles.current.reset();
        active.current = null;
        countdown.current = null;
        set({ phase: 'positioning', statusMessage: p.setupInstructions[0] ?? null, cue: null });
        return;
      }

      // ---------- Common live signals ----------
      const tracked = st.trackingState;
      const candidates = frameStore.candidates;
      const view = lms ? assessCameraView(lms, JOINT_DEFS[joint].plane) : null;
      const viewSuitability = view ? view.suitability : 0;
      const calQ = lms ? assessCalibrationQuality(lms, 0.7) : null;
      const angle = Number.isFinite(st.liveAngle) ? st.liveAngle : NaN;
      const vel = Number.isFinite(st.liveVel) ? st.liveVel : 0;

      // ---------- POSITIONING: framing + plane + lock presence ----------
      if (f.phase === 'positioning') {
        const framing = checkFraming(lms, 1, 1);
        const blockers = [
          ...framing.filter((x) => x.severity === 'blocker').map((x) => x.message),
          ...(view && viewSuitability < 0.55 && view.guidance ? [view.guidance] : []),
        ];
        if (tracked !== 'locked') blockers.unshift(tracked === 'lost' ? 'TARGET LOST' : 'NO SUBJECT IN FRAME');
        if (blockers.length === 0) {
          set({ phase: 'calibrating', cue: 'hold-still', statusMessage: 'Good position. Hold still.', blockers: [] });
          countdown.current = { t0: now, n: 3 };
          return;
        }
        const hint = cueFor(blockers, view?.guidance ?? null);
        set({
          blockers,
          cue: hint?.cue ?? null,
          statusMessage: hint?.message ?? blockers[0],
        });
        return;
      }

      // ---------- CALIBRATING: progressive automatic readiness + countdown ----------
      if (f.phase === 'calibrating') {
        const checks = {
          body: calQ ? calQ.fullBodyVisible : false,
          plane: viewSuitability >= 0.55,
          quality: st.liveLevel === 'high' || st.liveLevel === 'moderate',
          locked: tracked === 'locked',
        };
        const blockers: string[] = [];
        if (!checks.locked) blockers.push(tracked === 'lost' ? 'TARGET LOST' : 'NO SUBJECT IN FRAME');
        if (calQ) blockers.push(...calQ.blockers);
        if (!checks.plane && view?.guidance) blockers.push(view.guidance);
        if (blockers.length > 0) {
          countdown.current = null;
          const hint = cueFor(blockers, view?.guidance ?? null);
          set({ phase: 'positioning', blockers, cue: hint?.cue ?? null, statusMessage: hint?.message ?? blockers[0] });
          useFocus.getState().set({ autoRecoveries: useFocus.getState().autoRecoveries + 1 });
          return;
        }
        // All checks green — run a short hold-still countdown, then capture.
        const cd = countdown.current ?? { t0: now, n: 3 };
        countdown.current = cd;
        const elapsed = Math.floor((now - cd.t0) / 1000);
        const remaining = 3 - elapsed;
        if (remaining > 0) {
          if (f.cue !== 'hold-still' || f.statusMessage !== `Hold still — ${remaining}`) {
            set({ cue: 'hold-still', statusMessage: `Hold still — ${remaining}` });
          }
          return;
        }
        // Capture the neutral reference with the real calibration engine.
        if (lms) {
          const patient = usePatients.getState().activePatient();
          const res = captureReference(lms, {
            patientHeightCm: patient.heightCm ?? 170,
            bodyMassKg: patient.massKg,
            affectedSide: p.affectedSideRequired ? f.side : patient.affectedSide,
            movementId: p.movementId,
            cameraPlane: p.preferredPlane,
            sensorIds: [],
          }, 0.7, now);
          st.set({
            calibQuality: res.quality.score,
            session: { ...useSession.getState().session, affectedSide: res.config.affectedSide },
          });
        }
        countdown.current = null;
        set({ phase: 'acquiring', cue: null, statusMessage: 'Calibrated. Acquiring patient…' });
        return;
      }

      // ---------- ACQUIRING: automatic lock when unambiguous, ask on ambiguity ----------
      if (f.phase === 'acquiring') {
        if (tracked === 'locked') {
          set({ phase: 'ready', cue: 'ready', statusMessage: 'Ready — begin when comfortable.', readyAt: useFocus.getState().readyAt ?? now });
          onset.current.reset();
          return;
        }
        if (candidates.length === 1 && st.activeSubjectId === null) {
          engineRefs.tracker.selectSubject(candidates[0].id, now);
          st.set({ activeSubjectId: candidates[0].id });
          return;
        }
        if (candidates.length > 1 && st.activeSubjectId === null) {
          // Ambiguous — ask for one tap, never guess.
          if (!f.needsTap) set({ needsTap: true, statusMessage: 'Tap the patient to lock.', cue: null });
          return;
        }
        if (tracked === 'lost') {
          set({ statusMessage: 'Patient lost — attempting reacquisition…', cue: null });
        }
        return;
      }

      // ---------- READY: detect movement onset, start automatically ----------
      if (f.phase === 'ready') {
        const gate = canEnterReady({
          tracking: tracked,
          calibQuality: st.calibQuality,
          viewSuitability,
          level: st.liveLevel,
        });
        if (!gate.ok) {
          set({ phase: 'positioning', blockers: gate.blockers, statusMessage: gate.blockers[0], cue: 'hold-still' });
          return;
        }
        if (tracked !== 'locked') {
          set({ phase: 'acquiring', statusMessage: 'Patient lost — reacquiring…', cue: null });
          return;
        }
        if (Number.isFinite(angle) && st.liveLevel !== 'suspended') {
          onset.current.observeRest(angle, now);
          const manual = f.manualStartRequested;
          if (manual) set({ manualStartRequested: false });
          if (manual || onset.current.detect(angle, vel, p.completionCriteria.onsetDeg)) {
            const crit = p.completionCriteria;
            active.current = {
              startT: now, startAngle: angle, samples: [],
              validCount: 0, totalCount: 0, occludedCount: 0,
              viewSum: 0, viewCount: 0, confSum: 0,
            };
            completion.current.arm(angle);
            cycles.current.reset();
            st.set({ recording: true, recordStart: now, repCount: 0, compensations: [] });
            set({ phase: 'recording', cue: 'begin', statusMessage: `Trial ${f.trialIndex + 1} of ${crit.trialCount} — recording.` });
          }
        }
        return;
      }

      // ---------- RECORDING: collect, count cycles, detect completion ----------
      if (f.phase === 'recording') {
        const a = active.current;
        if (!a) { set({ phase: 'ready', cue: 'ready', statusMessage: 'Ready — begin when comfortable.' }); return; }
        const crit = p.completionCriteria;
        if (Number.isFinite(angle) && st.liveLevel !== 'suspended') {
          a.samples.push({ t: now, angle, vel });
          a.validCount += 1;
          a.viewSum += viewSuitability;
          a.viewCount += 1;
          a.confSum += st.liveLevel === 'high' ? 1 : st.liveLevel === 'moderate' ? 0.75 : 0.4;
          cycles.current.push(angle, vel, crit.minExcursionDeg);
        } else {
          a.occludedCount += 1;
        }
        a.totalCount += 1;
        const stats = summarizeTrial(a.samples);
        const excursion = stats ? stats.excursion : 0;
        const tolDeg = Math.max(6, excursion * crit.returnToleranceFrac || crit.onsetDeg);
        const done = completion.current.detect({
          now, angle: Number.isFinite(angle) ? angle : a.startAngle, vel, valid: Number.isFinite(angle),
          cyclesDone: cycles.current.cycles, required: crit.cyclesPerTrial,
          returnTolDeg: tolDeg, stillnessMs: crit.stillnessMs,
          startT: a.startT, maxDurationMs: crit.maxDurationMs,
          excursionSoFar: excursion, minExcursionDeg: crit.minExcursionDeg,
        });
        if (f.cue !== null && a.samples.length > 4) set({ cue: null });
        if (!done) {
          const want = `Trial ${f.trialIndex + 1} of ${crit.trialCount} · rep ${Math.min(cycles.current.cycles + 1, crit.cyclesPerTrial)}/${crit.cyclesPerTrial}`;
          if (f.statusMessage !== want) set({ statusMessage: want });
          return;
        }
        // Trial finished — hand to validation.
        st.set({ recording: false });
        set({ phase: 'validating', statusMessage: 'Checking trial quality…' });
        return;
      }

      // ---------- VALIDATING: automatic quality gate ----------
      if (f.phase === 'validating') {
        const a = active.current;
        const crit = p.completionCriteria;
        if (!a) { set({ phase: 'ready', cue: 'ready', statusMessage: 'Ready — begin when comfortable.' }); return; }
        const total = Math.max(1, a.totalCount);
        const verdict = evaluateTrialQuality({
          samples: a.samples,
          minSamples: 10,
          validRatio: a.validCount / total,
          tracking: tracked === 'locked' ? 'locked' : tracked,
          calibQuality: st.calibQuality,
          viewSuitability: a.viewCount ? a.viewSum / a.viewCount : viewSuitability,
          liveLevel: st.liveLevel === 'suspended' ? 'suspended' : 'moderate',
          completedCycles: cycles.current.cycles,
          requiredCycles: crit.cyclesPerTrial,
          minExcursionDeg: crit.minExcursionDeg,
          occludedRatio: a.occludedCount / total,
        });
        const avgConf = a.viewCount ? a.confSum / a.viewCount : 0.5;
        const trial = {
          index: f.trialIndex,
          peak: verdict.stats ? verdict.stats.max : NaN,
          min: verdict.stats ? verdict.stats.min : NaN,
          excursion: verdict.stats ? verdict.stats.excursion : 0,
          peakVelocity: verdict.stats ? verdict.stats.peakVelocity : 0,
          duration: verdict.stats ? verdict.stats.duration : (now - a.startT) / 1000,
          sampleCount: a.validCount,
          verdict: verdict.verdict,
          reasons: verdict.reasons,
          confidence: avgConf,
          startedAt: a.startT,
          endedAt: now,
        };
        const trials = [...f.trials.filter((t) => t.index !== f.trialIndex), trial].sort((x, y) => x.index - y.index);
        active.current = null;
        if (trialNeedsRetake(trial)) {
          set({
            trials, retakes: f.retakes + 1,
            phase: 'ready-next',
            cue: 'return-to-start',
            statusMessage: trial.verdict === 'invalid'
              ? `Retake required — ${trial.reasons[0] ?? 'trial could not be measured.'}`
              : `Retake recommended — ${trial.reasons[0] ?? 'quality was low.'}`,
          });
          return;
        }
        const isLast = f.trialIndex + 1 >= crit.trialCount;
        if (isLast) {
          const best = selectBestTrial(trials);
          // Persist the best trial as a visit so Progress + Report pick it up.
          const patient = usePatients.getState().activePatient();
          const prev = patient.visits.filter((v) => v.movementId === p.movementId);
          const bestTrial = best ? trials.find((t) => t.index === best.index) ?? trial : trial;
          const visitId = `focus-${Date.now()}`;
          usePatients.getState().addVisit({
            id: visitId,
            date: `Today · ${new Date().toLocaleDateString()}`,
            movementId: p.movementId,
            jointLabel: JOINT_DEFS[joint].label,
            peak: bestTrial.peak,
            excursion: bestTrial.excursion,
            peakVelocity: bestTrial.peakVelocity,
            reps: crit.cyclesPerTrial,
          });
          void prev;
          set({
            trials,
            bestIndex: best ? best.index : trial.index,
            bestReason: best ? best.reason : null,
            savedVisitId: visitId,
            phase: 'assessment-complete',
            cue: 'assessment-complete',
            statusMessage: 'Assessment complete.',
          });
        } else {
          set({
            trials,
            phase: 'trial-complete',
            cue: 'rep-complete',
            statusMessage: `Trial ${f.trialIndex + 1} complete — ${Number.isFinite(trial.excursion) ? trial.excursion.toFixed(0) : '—'}°.`,
          });
          // Auto-advance after a short beat so the therapist sees the result.
          setTimeout(() => {
            const cur = useFocus.getState();
            if (cur.phase === 'trial-complete' && cur.experience === 'focus') {
              onset.current.reset();
              completion.current.reset();
              cycles.current.reset();
              cur.set({ phase: 'ready', trialIndex: cur.trialIndex + 1, cue: 'ready', statusMessage: 'Ready for the next trial.' });
            }
          }, 2500);
        }
        return;
      }

      if (f.phase === 'ready-next') {
        // Retake loop: re-arm the same trial index as soon as conditions are green.
        const gate = canEnterReady({
          tracking: tracked,
          calibQuality: st.calibQuality,
          viewSuitability,
          level: st.liveLevel,
        });
        if (gate.ok && tracked === 'locked') {
          if (f.cue !== 'ready') {
            onset.current.reset();
            set({ cue: 'ready', statusMessage: 'Ready for retake — begin when comfortable.' });
          }
          if (Number.isFinite(angle) && st.liveLevel !== 'suspended') {
            onset.current.observeRest(angle, now);
            if (onset.current.detect(angle, vel, p.completionCriteria.onsetDeg)) {
              const crit = p.completionCriteria;
              active.current = {
                startT: now, startAngle: angle, samples: [],
                validCount: 0, totalCount: 0, occludedCount: 0,
                viewSum: 0, viewCount: 0, confSum: 0,
              };
              completion.current.arm(angle);
              cycles.current.reset();
              st.set({ recording: true, recordStart: now, compensations: [] });
              set({ phase: 'recording', cue: 'begin', statusMessage: `Retaking trial ${f.trialIndex + 1} — recording.` });
            }
          }
        }
        return;
      }

      void lastPhase;
      void resolveJoints;
    }, 200);

    return () => clearInterval(id);
  }, []);
}
