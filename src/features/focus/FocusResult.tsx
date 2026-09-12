import { useMemo } from 'react';
import { useSession } from '../../stores/sessionStore';
import { usePatients } from '../../stores/patientStore';
import { aggregateTrials } from '../rom/romEngine';
import { symmetryOf } from '../movement/symmetryEngine';
import { JOINT_DEFS } from '../biomechanics/jointAngles';
import { getProtocol, primaryJoint } from './protocols';
import { useFocus } from './focusStore';

/** Automatic result screen: best trial, consistency, comparison, findings. */
export default function FocusResult() {
  const f = useFocus();
  const set = useFocus((s) => s.set);
  const patient = usePatients((s) => s.activePatient());
  const setSession = useSession((s) => s.set);
  const timeline = useSession((s) => s.timeline);
  const compensations = useSession((s) => s.compensations);
  const protocol = f.protocolId ? getProtocol(f.protocolId) : undefined;

  const prev = useMemo(() => {
    if (!protocol) return null;
    const list = patient.visits.filter((v) => v.movementId === protocol.movementId && v.id !== f.savedVisitId);
    return list.length ? list[list.length - 1] : null;
  }, [patient, protocol, f.savedVisitId]);

  if (!protocol) return null;
  const joint = primaryJoint(protocol, f.side);
  const label = `${f.side === 'left' ? 'LEFT' : 'RIGHT'} ${protocol.name.toUpperCase()}`;

  const romTrials = f.trials
    .filter((t) => t.verdict === 'valid' || t.verdict === 'valid-warning')
    .map((t, k) => ({
      id: `focus-t${t.index}`, joint, start: t.min, peak: t.peak, min: t.min,
      excursion: t.excursion, peakVelocity: t.peakVelocity, duration: t.duration,
      sampleCount: t.sampleCount, startedAt: t.startedAt, endedAt: t.endedAt,
      key: k,
    }));
  const agg = aggregateTrials(romTrials);
  const best = f.bestIndex !== null ? f.trials.find((t) => t.index === f.bestIndex) : null;
  const validCount = f.trials.filter((t) => t.verdict === 'valid' || t.verdict === 'valid-warning').length;

  // Bilateral symmetry from the timeline when the protocol is bilateral.
  let symmetry: ReturnType<typeof symmetryOf> = null;
  if (protocol.bilateral) {
    const l = timeline.map((s) => s.angles[protocol.joints.left]).filter(Number.isFinite) as number[];
    const r = timeline.map((s) => s.angles[protocol.joints.right]).filter(Number.isFinite) as number[];
    if (l.length && r.length) {
      symmetry = symmetryOf('Peak angle symmetry', Math.max(...l), Math.max(...r), '°');
    }
  }

  const findings = compensations.filter((c) => protocol.compensationRules.includes(c.id));

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto p-6">
      <div>
        <p className="text-[11px] font-bold tracking-[0.28em] text-emerald-300/80">ASSESSMENT COMPLETE</p>
        <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-50">{label}</h2>
        <p className="mt-1 text-sm text-slate-400">{patient.name} · {new Date().toLocaleDateString()}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          ['BEST ROM', best && Number.isFinite(best.excursion) ? `${best.excursion.toFixed(0)}°` : '—'],
          ['AVERAGE', agg ? `${agg.meanExcursion.toFixed(1)}°` : '—'],
          ['PREVIOUS', prev ? `${prev.excursion.toFixed(0)}°` : '—'],
          ['CHANGE', prev && best && Number.isFinite(best.excursion) ? `${(best.excursion - prev.excursion >= 0 ? '+' : '')}${(best.excursion - prev.excursion).toFixed(0)}°` : '—'],
        ] as Array<[string, string]>).map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-[10px] tracking-[0.2em] text-slate-500">{k}</p>
            <p className="font-mono text-2xl font-extrabold text-slate-50">{v}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
        <p>
          Confidence <strong className="text-slate-100">HIGH</strong> · Trials{' '}
          <strong className="font-mono text-slate-100">{validCount} / {protocol.completionCriteria.trialCount} VALID</strong>
          {agg && agg.n > 1 && <span className="text-slate-400"> · consistency SD {agg.sdExcursion.toFixed(1)}°</span>}
        </p>
        {f.bestReason && <p className="mt-1 text-slate-400">{f.bestReason}</p>}
        {symmetry && (
          <p className="mt-1">
            Bilateral symmetry <strong className="font-mono text-slate-100">{symmetry.symmetryPct.toFixed(1)}%</strong>{' '}
            <span className="text-slate-400">(L {symmetry.left.toFixed(0)}° · R {symmetry.right.toFixed(0)}° · Δ {symmetry.difference.toFixed(0)}°)</span>
          </p>
        )}
      </div>

      {findings.length > 0 && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3">
          <p className="text-[11px] font-bold tracking-[0.2em] text-amber-300">FINDINGS</p>
          {findings.slice(0, 3).map((c) => (
            <p key={c.id} className="mt-1 text-sm text-amber-100">⚠ {c.label} — {c.detail}</p>
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <button
          onClick={() => {
            // Accept: visit already persisted by the orchestrator; go to review/report.
            set({ phase: 'review' });
            setSession({ appMode: 'report' });
            useFocus.getState().set({ experience: 'lab' });
          }}
          className="rounded-2xl bg-sky-500 px-4 py-3 text-base font-extrabold text-white hover:bg-sky-400"
        >
          SAVE ASSESSMENT
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const cur = useFocus.getState();
              cur.set({ phase: 'ready', trialIndex: 0, trials: [], bestIndex: null, bestReason: null, savedVisitId: null, cue: 'ready', statusMessage: 'Ready — begin when comfortable.' });
            }}
            className="flex-1 rounded-2xl bg-white/5 px-4 py-2.5 text-sm font-bold tracking-widest text-slate-200 ring-1 ring-white/15 hover:bg-white/10"
          >
            REPEAT
          </button>
          <button
            onClick={() => {
              set({ phase: 'review' });
              useFocus.getState().set({ experience: 'lab' });
            }}
            className="flex-1 rounded-2xl bg-white/5 px-4 py-2.5 text-sm font-bold tracking-widest text-slate-200 ring-1 ring-white/15 hover:bg-white/10"
          >
            DETAILED ANALYSIS
          </button>
        </div>
        <p className="text-center text-[11px] text-slate-600">
          {JOINT_DEFS[joint].label} · saved to {patient.name}’s record · report prepared automatically
        </p>
      </div>
    </div>
  );
}
