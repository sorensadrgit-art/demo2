import { useSession } from '../../stores/sessionStore';
import { JOINT_DEFS } from '../biomechanics/jointAngles';
import { CONFIDENCE_STYLE, formatAngle } from '../biomechanics/confidence';
import { useEffect, useState } from 'react';

function useLiveMetrics() {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 150);
    return () => clearInterval(id);
  }, []);
  return useSession.getState();
}

/** Live joint readout: KNEE FLEXION / 112.4° LIVE / MAX / MIN / VELOCITY / CONFIDENCE. */
export default function ROMPanel() {
  useLiveMetrics();
  const s = useSession.getState();
  const def = JOINT_DEFS[s.activeJoint];
  const conf = CONFIDENCE_STYLE[s.liveLevel];
  const series = s.timeline.filter((p) => Number.isFinite(p.angles[s.activeJoint]));
  const vals = series.map((p) => p.angles[s.activeJoint] as number);
  const max = vals.length ? Math.max(...vals) : NaN;
  const min = vals.length ? Math.min(...vals) : NaN;

  return (
    <section aria-label="Live joint measurement" className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-bold tracking-[0.22em] text-slate-400">{def.label.toUpperCase()}</h2>
        <span className="text-[10px] font-bold tracking-widest" style={{ color: conf.color }}>● {conf.label.toUpperCase()}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-5xl font-semibold tracking-tight text-slate-50">
          {formatAngle(s.liveAngle, s.liveLevel)}
        </span>
        <span className="text-[10px] font-bold tracking-[0.2em] text-sky-300">LIVE</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[13px]">
        <div className="flex justify-between"><dt className="font-sans text-[10px] tracking-widest text-slate-500">MAX</dt><dd className="text-slate-200">{formatAngle(max, s.liveLevel)}</dd></div>
        <div className="flex justify-between"><dt className="font-sans text-[10px] tracking-widest text-slate-500">MIN</dt><dd className="text-slate-200">{formatAngle(min, s.liveLevel)}</dd></div>
        <div className="flex justify-between"><dt className="font-sans text-[10px] tracking-widest text-slate-500">PEAK VELOCITY</dt><dd className="text-slate-200">{Number.isFinite(s.liveVel) && s.liveLevel !== 'suspended' ? `${Math.abs(s.liveVel).toFixed(0)}°/s` : '—'}</dd></div>
        <div className="flex justify-between"><dt className="font-sans text-[10px] tracking-widest text-slate-500">CONFIDENCE</dt><dd style={{ color: conf.color }}>{s.liveLevel === 'suspended' ? 'SUSPENDED' : `${Math.round((s.timeline[s.timeline.length - 1]?.confidence ?? 0) * 100)}%`}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Select joint">
        {(Object.keys(JOINT_DEFS) as Array<keyof typeof JOINT_DEFS>).slice(0, 12).map((id) => (
          <button
            key={id}
            onClick={() => s.set({ activeJoint: id })}
            className={`rounded px-1.5 py-1 text-[10px] font-semibold ${s.activeJoint === id ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/50' : 'bg-white/[0.04] text-slate-400 ring-1 ring-white/10 hover:text-slate-200'}`}
          >
            {JOINT_DEFS[id].label.replace('L ', '').replace('R ', '')}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
        Camera-derived measures are experimental and not medically validated. Tip: click any joint directly on the patient.
      </p>
    </section>
  );
}
