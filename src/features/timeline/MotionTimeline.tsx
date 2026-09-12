import { useSession } from '../../stores/sessionStore';
import { JOINT_DEFS } from '../biomechanics/jointAngles';
import Waveform from './Waveform';

/** Synchronized session timeline: angle + velocity + events + flags. */
export default function MotionTimeline() {
  const timeline = useSession((s) => s.timeline);
  const activeJoint = useSession((s) => s.activeJoint);
  const scrubT = useSession((s) => s.scrubT);
  const compensations = useSession((s) => s.compensations);
  const kineticSamples = useSession((s) => s.kineticSamples);
  const sensorSamples = useSession((s) => s.sensorSamples);
  const recording = useSession((s) => s.recording);
  const recordStart = useSession((s) => s.recordStart);
  const set = useSession((s) => s.set);

  const repEvents = timeline.length
    ? [] as Array<{ t: number; label: string; color: string }>
    : [];
  const flagEvents = compensations.map((c) => ({ t: c.timestamp, label: c.label, color: '#fb7185' }));

  const toggleRecord = () => {
    if (recording) set({ recording: false });
    else set({ recording: true, recordStart: performance.now() });
  };

  const exportWindow = { t0: timeline[0]?.t ?? 0, t1: timeline[timeline.length - 1]?.t ?? 0 };

  return (
    <section aria-label="Motion timeline" className="border-t border-white/10 bg-black/50 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={toggleRecord}
          className={`rounded px-3 py-1 text-[11px] font-bold tracking-widest ${recording ? 'bg-rose-500 text-white' : 'bg-white/5 text-slate-200 ring-1 ring-white/15'}`}
          aria-pressed={recording}
        >
          {recording ? '● STOP TRIAL' : '○ RECORD TRIAL'}
        </button>
        <span className="font-mono text-[11px] text-slate-400">
          {JOINT_DEFS[activeJoint].label} · {timeline.length} samples
          {recordStart !== null && recording ? ` · REC ${(performance.now() - recordStart) / 1000 < 0 ? 0 : ((exportWindow.t1 - recordStart) / 1000).toFixed(1)}s` : ''}
        </span>
        <span className="font-mono text-[11px] text-slate-500">
          KINETIC EST {kineticSamples.length} · SENSOR {sensorSamples.length}
        </span>
        {scrubT !== null && (
          <button onClick={() => set({ scrubT: null })} className="rounded bg-white/5 px-2 py-1 text-[11px] text-slate-300 ring-1 ring-white/10">
            LIVE
          </button>
        )}
      </div>
      <Waveform
        samples={timeline}
        joint={activeJoint}
        height={110}
        scrubT={scrubT}
        events={[...repEvents, ...flagEvents]}
        onScrub={(t) => set({ scrubT: t })}
      />
      {compensations.length > 0 && (
        <div className="flex max-h-16 flex-wrap gap-1.5 overflow-y-auto pb-1" aria-label="Compensation flags">
          {compensations.slice(-8).map((c, i) => (
            <button
              key={`${c.id}-${i}`}
              onClick={() => set({ scrubT: c.timestamp })}
              className="rounded bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-200 ring-1 ring-rose-400/30 hover:bg-rose-500/20"
              title={c.evidence.map((e) => `${e.metric}: ${e.value.toFixed(1)}${e.unit} (threshold ${e.threshold}${e.unit})`).join('; ')}
            >
              ⚠ {c.label} · {c.detail}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
