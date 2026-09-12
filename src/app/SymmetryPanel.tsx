import { useSession } from '../stores/sessionStore';
import { JOINT_DEFS, type JointId } from '../features/biomechanics/jointAngles';
import { symmetryOf } from '../features/movement/symmetryEngine';

/** Bilateral comparison: L/R simultaneously with exposed underlying metrics. */
export default function SymmetryPanel() {
  const activeJoint = useSession((s) => s.activeJoint);
  const timeline = useSession((s) => s.timeline);
  const def = JOINT_DEFS[activeJoint];
  const mirrorId = def.mirrorOf as JointId | undefined;

  if (!mirrorId) {
    return <p className="p-4 text-xs text-slate-500">Select a paired limb joint to compare sides.</p>;
  }
  const L = timeline.map((p) => p.angles[activeJoint]).filter(Number.isFinite) as number[];
  const R = timeline.map((p) => p.angles[mirrorId]).filter(Number.isFinite) as number[];
  const peak = (a: number[]) => (a.length ? Math.max(...a) : NaN);
  const m = symmetryOf('Peak angle', peak(L), peak(R), '°');
  const lCur = L[L.length - 1]; const rCur = R[R.length - 1];
  const cur = symmetryOf('Live angle', lCur, rCur, '°');

  const Row = ({ title, s }: { title: string; s: ReturnType<typeof symmetryOf> }) => (
    <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
      <p className="text-[10px] tracking-widest text-slate-500">{title.toUpperCase()}</p>
      {s ? (
        <p className="mt-0.5 font-mono text-sm text-slate-100">
          L {s.left.toFixed(1)}° · R {s.right.toFixed(1)}° · Δ {s.difference.toFixed(1)}° · <span className="text-sky-300">{s.symmetryPct.toFixed(1)}%</span>
        </p>
      ) : (
        <p className="mt-0.5 font-mono text-sm text-slate-500">— awaiting bilateral data</p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-2 p-4">
      <h3 className="text-[11px] font-bold tracking-[0.22em] text-slate-400">
        SYMMETRY · {JOINT_DEFS[activeJoint].label.toUpperCase()} vs {JOINT_DEFS[mirrorId].label.toUpperCase()}
      </h3>
      <Row title="Live" s={cur} />
      <Row title="Peak" s={m} />
      {/* Bilateral waveform */}
      <div className="rounded-lg border border-white/10 bg-black/40 p-2">
        <BilateralWave left={L.slice(-300)} right={R.slice(-300)} />
      </div>
      <div className="flex gap-1.5">
        {(['leftKnee', 'rightKnee', 'leftShoulderAbd', 'rightShoulderAbd', 'leftElbow', 'rightElbow'] as JointId[]).map((id) => (
          <button
            key={id}
            onClick={() => useSession.getState().set({ activeJoint: id })}
            className={`rounded px-1.5 py-1 text-[10px] font-semibold ${activeJoint === id ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/50' : 'bg-white/[0.04] text-slate-400 ring-1 ring-white/10'}`}
          >
            {JOINT_DEFS[id].label}
          </button>
        ))}
      </div>
    </div>
  );
}

function BilateralWave({ left, right }: { left: number[]; right: number[] }) {
  const n = Math.max(left.length, right.length);
  if (n < 2) return <p className="p-2 text-[11px] text-slate-500">Move both limbs to render synchronization.</p>;
  const all = [...left, ...right];
  const lo = Math.min(...all); const hi = Math.max(...all);
  const W = 100; const H = 60;
  const X = (i: number) => (i / Math.max(1, n - 1)) * W;
  const Y = (v: number) => H - 4 - ((v - lo) / Math.max(1e-6, hi - lo)) * (H - 8);
  const path = (a: number[]) => a.map((v, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" role="img" aria-label="Bilateral synchronization waveform">
      <path d={path(left)} fill="none" stroke="#38bdf8" strokeWidth="1.4" />
      <path d={path(right)} fill="none" stroke="#f472b6" strokeWidth="1.4" strokeDasharray="3 2" />
      <text x="2" y="9" fontSize="5" fill="#7fb3dd">— LEFT</text>
      <text x="22" y="9" fontSize="5" fill="#f472b6">- - RIGHT</text>
    </svg>
  );
}
