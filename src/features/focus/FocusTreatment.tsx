import { useMemo } from 'react';
import CameraCapture from '../capture/CameraCapture';
import { useSession } from '../../stores/sessionStore';
import { usePatients } from '../../stores/patientStore';
import { useUI } from '../../stores/uiStore';
import { CONFIDENCE_STYLE, formatAngle } from '../biomechanics/confidence';
import { getProtocol } from './protocols';
import { useFocus } from './focusStore';

const CUE_TEXT: Record<string, string> = {
  'step-into-frame': 'Step into the frame',
  'step-back': 'Step one step back',
  'center-patient': 'Center the patient',
  'turn-sideways': 'Turn sideways',
  'turn-front': 'Face the camera',
  'hold-still': 'Hold still',
  ready: 'Ready — begin when comfortable',
  begin: 'Go',
  'rep-complete': 'Rep complete — return to start',
  'return-to-start': 'Return to start position',
  'assessment-complete': 'Assessment complete',
};

/** Simplified treatment screen: patient dominates, one status rail, contextual controls. */
export default function FocusTreatment() {
  const f = useFocus();
  const patient = usePatients((s) => s.activePatient());
  const localOnly = useUI((s) => s.localOnly);
  const setSession = useSession((s) => s.set);
  const tracking = useSession((s) => s.trackingState);
  const liveAngle = useSession((s) => s.liveAngle);
  const liveLevel = useSession((s) => s.liveLevel);
  const protocol = f.protocolId ? getProtocol(f.protocolId) : undefined;
  const crit = protocol?.completionCriteria;

  const prev = useMemo(() => {
    if (!protocol) return null;
    const list = patient.visits.filter((v) => v.movementId === protocol.movementId);
    return list.length ? list[list.length - 1] : null;
  }, [patient, protocol]);

  if (!protocol || !crit) return null;

  const trackingLabel = tracking === 'locked' ? 'TARGET LOCKED' : tracking === 'reacquiring' ? 'REACQUIRING' : tracking === 'lost' ? 'TARGET LOST' : 'NO LOCK';
  const confStyle = CONFIDENCE_STYLE[liveLevel];
  const current = f.trials[f.trials.length - 1];
  const trialNo = Math.min(f.trialIndex + 1, crit.trialCount);
  const busy = f.phase === 'recording' || f.phase === 'validating';
  const actionable = f.blockers.length > 0 && (f.phase === 'positioning' || f.phase === 'ready-next');
  // Zero-chrome clinical capture: during the measurement window the camera
  // owns the workspace — rail, ROM dashboard and lock/confidence chrome move
  // off the capture surface (the angle lives on the patient overlay).
  const minimalCapture = f.phase === 'ready' || f.phase === 'recording'
    || f.phase === 'validating' || f.phase === 'ready-next' || f.phase === 'trial-complete';

  const manualStart = () => {
    // Manual override: the orchestrator opens the trial window on next tick.
    useFocus.getState().set({
      manualStartRequested: true,
      manualOverrides: useFocus.getState().manualOverrides + 1,
    });
  };

  const endTrial = () => {
    useSession.getState().set({ recording: false });
    useFocus.getState().set({ phase: 'validating', statusMessage: 'Checking trial quality…', manualOverrides: useFocus.getState().manualOverrides + 1 });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Minimal top bar: patient · assessment · trial (lock/confidence live on the patient overlay, not as chrome) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/10 bg-black/60 px-4 py-2 text-[12px]" aria-live="polite">
        <span className="font-extrabold tracking-wide text-slate-100">{patient.name}</span>
        <span className="tracking-widest text-sky-300">{protocol.name.toUpperCase()}{!protocol.bilateral ? ` · ${f.side.toUpperCase()}` : ''}</span>
        <span className="font-mono text-slate-400">TRIAL {trialNo}/{crit.trialCount}</span>
        {!minimalCapture && (
          <>
            <span className={`font-bold tracking-widest ${tracking === 'locked' ? 'text-emerald-300' : tracking === 'reacquiring' ? 'text-amber-300' : 'text-rose-300'}`}>
              {trackingLabel}
            </span>
            <span className="font-mono" style={{ color: confStyle.color }}>
              {liveLevel === 'suspended' ? 'SUSPENDED' : `${Math.round((liveLevel === 'high' ? 0.92 : liveLevel === 'moderate' ? 0.72 : 0.45) * 100)}%`}
            </span>
          </>
        )}
        <span className="ml-auto hidden items-center gap-2 text-[11px] text-slate-500 sm:flex">
          <span>{localOnly ? 'Local processing' : 'Cloud sync on'}</span>
          <button
            onClick={() => useFocus.getState().set({ experience: 'lab' })}
            className="rounded bg-white/5 px-2 py-1 text-[10px] font-bold tracking-widest text-slate-400 ring-1 ring-white/10 hover:text-slate-200"
          >
            ADVANCED
          </button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Live patient canvas: nearly the entire clinical workspace in capture */}
        <main className="relative min-h-[52vh] flex-1 lg:min-h-0 lg:basis-[78%]" aria-label="Live patient">
          <CameraCapture />
          {/* Patient cue banner */}
          {f.cue && (
            <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2">
              <div className={`rounded-full px-5 py-2 text-sm font-extrabold tracking-wide shadow-lg ${busy ? 'bg-sky-500/90 text-white' : 'bg-black/75 text-slate-100 ring-1 ring-white/20'}`}>
                {CUE_TEXT[f.cue] ?? f.cue}
              </div>
            </div>
          )}
          {/* Actionable blocker */}
          {actionable && f.statusMessage && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
              <div className="rounded-xl bg-amber-500/90 px-4 py-2 text-sm font-bold text-black shadow-lg">
                ⚠ {f.statusMessage}
              </div>
            </div>
          )}
          {/* Minimal capture controls: trial progress + essential actions stay on the patient */}
          {minimalCapture && (
            <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 ring-1 ring-white/15" aria-label="Trial progress">
                {Array.from({ length: crit.trialCount }).map((_, i) => {
                  const t = f.trials.find((x) => x.index === i);
                  return (
                    <span
                      key={i}
                      title={t ? `Trial ${i + 1}: ${t.excursion.toFixed(0)}° ${t.verdict}` : `Trial ${i + 1} pending`}
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ring-1 ${
                        t ? (t.verdict === 'valid' || t.verdict === 'valid-warning' ? 'bg-emerald-500/25 text-emerald-200 ring-emerald-400/40' : 'bg-rose-500/25 text-rose-200 ring-rose-400/40')
                          : i === f.trialIndex ? 'bg-sky-500/25 text-sky-200 ring-sky-400/40' : 'bg-white/5 text-slate-500 ring-white/10'
                      }`}
                    >
                      {i + 1}
                    </span>
                  );
                })}
              </div>
              {f.phase === 'ready' && (
                <button onClick={manualStart} className="rounded-full bg-sky-500 px-4 py-1.5 text-xs font-extrabold text-white hover:bg-sky-400">
                  START MANUALLY
                </button>
              )}
              {f.phase === 'recording' && (
                <button onClick={endTrial} className="rounded-full bg-black/70 px-4 py-1.5 text-xs font-bold tracking-widest text-slate-200 ring-1 ring-white/15 hover:bg-white/10">
                  END TRIAL
                </button>
              )}
              <button
                onClick={() => useFocus.getState().reset()}
                className="ml-auto rounded-full bg-black/70 px-3 py-1.5 text-[11px] font-semibold text-slate-400 ring-1 ring-white/10 hover:text-slate-200"
              >
                Cancel assessment
              </button>
            </div>
          )}
        </main>

        {/* Clinical assistant rail (hidden during capture; Lab keeps every capability) */}
        {!minimalCapture && (
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-t border-white/10 bg-[#060b13] p-4 lg:w-[22%] lg:min-w-[240px] lg:border-l lg:border-t-0" aria-label="Clinical assistant">
          <p className="text-[10px] font-bold tracking-[0.24em] text-slate-500">CLINICAL ASSISTANT</p>
          <ReadinessList />
          <div className="rounded-xl border border-white/10 bg-black/40 p-3">
            <p className="text-[10px] tracking-widest text-slate-500">CURRENT ROM</p>
            <p className="font-mono text-3xl font-extrabold text-slate-50">{formatAngle(liveAngle, liveLevel)}</p>
            {prev && Number.isFinite(liveAngle) && (
              <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-xs">
                <div><p className="font-sans text-[10px] tracking-widest text-slate-500">PREVIOUS</p><p className="text-slate-300">{prev.peak.toFixed(0)}°</p></div>
                <div>
                  <p className="font-sans text-[10px] tracking-widest text-slate-500">CHANGE</p>
                  <p className={liveAngle - prev.peak >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                    {(liveAngle - prev.peak >= 0 ? '+' : '')}{(liveAngle - prev.peak).toFixed(0)}°
                  </p>
                </div>
              </div>
            )}
          </div>
          {/* Trial dots */}
          <div className="flex items-center gap-2" aria-label="Trial progress">
            {Array.from({ length: crit.trialCount }).map((_, i) => {
              const t = f.trials.find((x) => x.index === i);
              return (
                <span
                  key={i}
                  title={t ? `Trial ${i + 1}: ${t.excursion.toFixed(0)}° ${t.verdict}` : `Trial ${i + 1} pending`}
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ring-1 ${
                    t ? (t.verdict === 'valid' || t.verdict === 'valid-warning' ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/40' : 'bg-rose-500/20 text-rose-200 ring-rose-400/40')
                      : i === f.trialIndex ? 'bg-sky-500/20 text-sky-200 ring-sky-400/40' : 'bg-white/5 text-slate-500 ring-white/10'
                  }`}
                >
                  {i + 1}
                </span>
              );
            })}
            {current && <span className="ml-1 font-mono text-xs text-slate-400">last {current.excursion.toFixed(0)}°</span>}
          </div>
          {/* Contextual controls only */}
          <div className="mt-auto flex flex-col gap-2">
            {f.phase === 'ready' && (
              <>
                <button onClick={manualStart} className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-sky-400">
                  START MANUALLY
                </button>
                <button onClick={() => useFocus.getState().set({ phase: 'positioning', manualOverrides: useFocus.getState().manualOverrides + 1 })} className="rounded-xl bg-white/5 px-4 py-2 text-xs font-bold tracking-widest text-slate-300 ring-1 ring-white/15 hover:bg-white/10">
                  ADJUST SETUP
                </button>
              </>
            )}
            {f.phase === 'recording' && (
              <>
                <button onClick={() => useSession.getState().set({ recording: !useSession.getState().recording })} className="rounded-xl bg-white/5 px-4 py-2 text-xs font-bold tracking-widest text-slate-300 ring-1 ring-white/15 hover:bg-white/10">
                  PAUSE
                </button>
                <button onClick={endTrial} className="rounded-xl bg-white/5 px-4 py-2 text-xs font-bold tracking-widest text-slate-300 ring-1 ring-white/15 hover:bg-white/10">
                  END TRIAL
                </button>
              </>
            )}
            {(f.phase === 'ready-next' || f.phase === 'trial-complete') && f.statusMessage && (
              <p className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs leading-relaxed text-slate-300">{f.statusMessage}</p>
            )}
            <button
              onClick={() => useFocus.getState().reset()}
              className="rounded px-3 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-300"
            >
              Cancel assessment
            </button>
          </div>
        </aside>
        )}
      </div>
    </div>
  );
}

function ReadinessList() {
  const tracking = useSession((s) => s.trackingState);
  const calib = useSession((s) => s.calibQuality);
  const level = useSession((s) => s.liveLevel);
  const rows: Array<[string, boolean]> = [
    ['Patient lock', tracking === 'locked'],
    ['Calibration', calib >= 0.4],
    ['Motion plane', level !== 'suspended'],
    ['Landmark quality', level === 'high' || level === 'moderate'],
  ];
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map(([label, ok]) => (
        <li key={label} className="flex items-center gap-2 text-[12px]">
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-slate-500'}`}>
            {ok ? '✓' : '·'}
          </span>
          <span className={ok ? 'text-slate-200' : 'text-slate-500'}>{label}</span>
        </li>
      ))}
    </ul>
  );
}
