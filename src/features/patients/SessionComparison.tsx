import { usePatients } from '../../stores/patientStore';

/** Side-by-side current vs previous session comparison. */
export default function SessionComparison() {
  const patients = usePatients((s) => s.patients);
  const activePatientId = usePatients((s) => s.activePatientId);
  const p = patients.find((x) => x.id === activePatientId) ?? patients[0];
  const [a, b] = [p.visits[p.visits.length - 2], p.visits[p.visits.length - 1]];
  if (!a || !b) return <p className="p-4 text-xs text-slate-500">Need at least two visits to compare.</p>;
  const rows: Array<[string, number, number, string]> = [
    ['Peak angle', a.peak, b.peak, '°'],
    ['Excursion', a.excursion, b.excursion, '°'],
    ['Peak velocity', a.peakVelocity, b.peakVelocity, '°/s'],
    ['Repetitions', a.reps, b.reps, ''],
  ];
  return (
    <div className="overflow-x-auto p-4">
      <h3 className="text-[11px] font-bold tracking-[0.2em] text-slate-400">SESSION COMPARISON · {a.date} vs {b.date}</h3>
      <table className="mt-2 w-full font-mono text-xs text-slate-200">
        <thead><tr className="text-left text-slate-500"><th>METRIC</th><th>PREVIOUS</th><th>CURRENT</th><th>CHANGE</th></tr></thead>
        <tbody>
          {rows.map(([k, av, bv, u]) => {
            const d = bv - av;
            return (
              <tr key={k} className="border-t border-white/5">
                <td className="py-1.5">{k}</td>
                <td>{av.toFixed(1)}{u}</td>
                <td>{bv.toFixed(1)}{u}</td>
                <td className={d >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{d >= 0 ? '+' : ''}{d.toFixed(1)}{u}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
