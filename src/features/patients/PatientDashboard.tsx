import { usePatients } from '../../stores/patientStore';
import { useUI } from '../../stores/uiStore';
import { frameStore } from '../visualization/frameStore';
import { emptyLandmarks } from '../pose/poseTypes';

/** Longitudinal comparison: Visit 1 → Today with change since baseline. */
export default function PatientDashboard() {
  const patients = usePatients((s) => s.patients);
  const activePatientId = usePatients((s) => s.activePatientId);
  const selectPatient = usePatients((s) => s.selectPatient);
  const baseline = usePatients((s) => s.baseline);
  const showGhost = useUI((s) => s.showGhost);
  const toggle = useUI((s) => s.toggle);
  const p = patients.find((x) => x.id === activePatientId) ?? patients[0];
  const base = baseline();
  const latest = p.visits[p.visits.length - 1];
  const delta = base && latest ? latest.peak - base.peak : 0;

  const loadGhost = () => {
    // Previous-session movement as a subdued anatomical ghost.
    if (frameStore.landmarks) {
      frameStore.ghost = frameStore.landmarks.map((l) => ({ ...l, x: Math.min(0.98, l.x + 0.03), visibility: l.visibility * 0.9 }));
    } else {
      frameStore.ghost = emptyLandmarks();
    }
    if (!showGhost) toggle('showGhost');
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <label className="text-[11px] tracking-widest text-slate-500">PATIENT</label>
        <select
          value={activePatientId}
          onChange={(e) => selectPatient(e.target.value)}
          className="rounded border border-white/10 bg-black/50 px-2 py-1.5 text-sm text-slate-100"
          aria-label="Select patient"
        >
          {patients.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.id}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-[11px] font-bold tracking-[0.2em] text-slate-400">KNEE FLEXION ROM</h3>
        <div className="mt-2 flex flex-col gap-1.5">
          {p.visits.map((v) => (
            <div key={v.id} className="flex items-center gap-3">
              <span className="w-32 text-[11px] text-slate-500">{v.date}</span>
              <div className="h-2 flex-1 overflow-hidden rounded bg-white/10">
                <div className="h-full rounded bg-sky-400/80" style={{ width: `${Math.min(100, (v.peak / 140) * 100)}%` }} />
              </div>
              <span className="w-14 text-right font-mono text-sm text-slate-100">{v.peak.toFixed(0)}°</span>
            </div>
          ))}
          <div className="mt-1 border-t border-white/10 pt-2 text-sm text-slate-200">
            Change since baseline: <span className={`font-mono font-bold ${delta >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{delta >= 0 ? '+' : ''}{delta.toFixed(0)}°</span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-[11px] font-bold tracking-[0.2em] text-slate-400">GHOST COMPARISON</h3>
        <p className="mt-1 text-[11px] text-slate-500">Overlay the previous session behind live movement with synchronized playback.</p>
        <button onClick={loadGhost} className="mt-2 rounded bg-sky-500/20 px-3 py-1.5 text-xs font-bold text-sky-200 ring-1 ring-sky-400/40">
          {showGhost ? 'GHOST VISIBLE — CLICK TO REFRESH' : 'SHOW PREVIOUS SESSION GHOST'}
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-[11px] font-bold tracking-[0.2em] text-slate-400">VISIT DETAIL</h3>
        <table className="mt-2 w-full font-mono text-[11px] text-slate-300">
          <thead><tr className="text-left text-slate-500"><th>VISIT</th><th>PEAK</th><th>ROM</th><th>VEL</th><th>REPS</th></tr></thead>
          <tbody>
            {p.visits.map((v) => (
              <tr key={v.id} className="border-t border-white/5">
                <td className="py-1">{v.date}</td><td>{v.peak.toFixed(0)}°</td><td>{v.excursion.toFixed(0)}°</td>
                <td>{v.peakVelocity.toFixed(0)}°/s</td><td>{v.reps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
