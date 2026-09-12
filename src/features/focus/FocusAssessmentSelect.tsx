import { usePatients } from '../../stores/patientStore';
import { CLINICAL_PROTOCOLS, defaultSideFor } from './protocols';
import { useFocus } from './focusStore';

/** Step 2: test-first assessment picker with previous-result context. */
export default function FocusAssessmentSelect() {
  const patient = usePatients((s) => s.activePatient());
  const begin = useFocus((s) => s.beginAssessment);
  const back = useFocus((s) => s.set);

  const grouped = new Map<string, typeof CLINICAL_PROTOCOLS>();
  for (const p of CLINICAL_PROTOCOLS) {
    const g = grouped.get(p.bodyRegion) ?? [];
    g.push(p);
    grouped.set(p.bodyRegion, g);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto p-6">
      <div>
        <p className="text-[11px] font-bold tracking-[0.28em] text-sky-300/80">FOCUS MODE · STEP 2 OF 2</p>
        <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-50">
          {patient.name} — <span className="text-slate-400">what are we testing?</span>
        </h2>
      </div>
      {[...grouped.entries()].map(([region, list]) => (
        <section key={region} aria-label={region}>
          <h3 className="mb-2 text-[11px] font-bold tracking-[0.24em] text-slate-500">{region.toUpperCase()}</h3>
          <div className="flex flex-col gap-2">
            {list.map((p) => {
              const prev = [...patient.visits].reverse().find((v) => v.movementId === p.movementId);
              const side = defaultSideFor(p, patient.affectedSide);
              return (
                <button
                  key={p.id}
                  onClick={() => begin(p.id, side)}
                  className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-left transition hover:border-sky-400/40 hover:bg-white/[0.05]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-bold text-slate-50">{p.name}</span>
                    <span className="block text-xs text-slate-400">
                      {p.preferredPlane === 'sagittal' ? 'Side view' : 'Front view'} · {p.completionCriteria.trialCount} trial{p.completionCriteria.trialCount === 1 ? '' : 's'}
                      {p.bilateral ? ' · bilateral' : p.affectedSideRequired ? ` · ${side.toUpperCase()} side` : ''}
                    </span>
                  </span>
                  {prev && (
                    <span className="shrink-0 text-right font-mono text-xs text-slate-400">
                      <span className="block text-[10px] tracking-widest text-slate-500">PREVIOUS</span>
                      {prev.peak.toFixed(0)}°
                    </span>
                  )}
                  <span className="shrink-0 text-sky-300">›</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <button
        onClick={() => back({ phase: 'patient' })}
        className="self-start rounded px-3 py-1 text-xs font-semibold text-slate-400 hover:text-slate-200"
      >
        ← Change patient
      </button>
    </div>
  );
}
