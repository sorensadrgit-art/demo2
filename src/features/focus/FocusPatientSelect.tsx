import { useState } from 'react';
import { usePatients } from '../../stores/patientStore';
import { useSession } from '../../stores/sessionStore';
import { useFocus } from './focusStore';

/** Step 1: recent patients first, search, lightweight new-patient path. */
export default function FocusPatientSelect() {
  const patients = usePatients((s) => s.patients);
  const activeId = usePatients((s) => s.activePatientId);
  const selectPatient = usePatients((s) => s.selectPatient);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const go = useFocus((s) => s.set);

  const q = query.trim().toLowerCase();
  const list = q ? patients.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : patients;

  const choose = (id: string) => {
    selectPatient(id);
    const p = usePatients.getState().patients.find((x) => x.id === id);
    if (p) {
      useSession.getState().set({
        session: { ...useSession.getState().session, patientId: id, affectedSide: p.affectedSide },
      });
      useFocus.getState().set({ side: p.affectedSide === 'right' ? 'right' : 'left' });
    }
    go({ phase: 'assessment', statusMessage: null });
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto p-6">
      <div>
        <p className="text-[11px] font-bold tracking-[0.28em] text-sky-300/80">FOCUS MODE · STEP 1 OF 2</p>
        <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-50">Who is the patient?</h2>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search patients…"
        aria-label="Search patients"
        className="rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-[15px] text-slate-100 placeholder:text-slate-600 focus:border-sky-400/60 focus:outline-none"
      />
      <div className="flex flex-col gap-2" role="listbox" aria-label="Patients">
        {list.map((p) => {
          const last = p.visits[p.visits.length - 1];
          return (
            <button
              key={p.id}
              role="option"
              aria-selected={p.id === activeId}
              onClick={() => choose(p.id)}
              className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-left transition hover:border-sky-400/40 hover:bg-white/[0.05]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sm font-extrabold text-sky-200 ring-1 ring-sky-400/30">
                {p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold text-slate-50">{p.name}</span>
                <span className="block text-xs text-slate-400">
                  {p.id} · {p.affectedSide !== 'na' ? `${p.affectedSide.toUpperCase()} affected` : 'no affected side set'}
                  {p.heightCm ? ` · ${p.heightCm} cm` : ''} · {p.visits.length} visit{p.visits.length === 1 ? '' : 's'}
                </span>
              </span>
              {last && (
                <span className="shrink-0 text-right font-mono text-xs text-slate-400">
                  <span className="block text-[10px] tracking-widest text-slate-500">LAST</span>
                  {last.peak.toFixed(0)}°
                </span>
              )}
              <span className="shrink-0 text-sky-300">›</span>
            </button>
          );
        })}
        {!list.length && <p className="text-sm text-slate-500">No patients match “{query}”.</p>}
      </div>
      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="rounded-2xl border border-dashed border-white/15 px-5 py-3 text-sm font-bold tracking-widest text-slate-400 hover:border-sky-400/40 hover:text-slate-200"
        >
          + NEW PATIENT
        </button>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            const id = `PT-${String(Date.now()).slice(-4)}`;
            usePatients.setState((st) => ({
              patients: [...st.patients, { id, name: trimmed, affectedSide: 'na' as const, visits: [] }],
            }));
            setName('');
            setAdding(false);
            choose(id);
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Patient name or initials"
            aria-label="New patient name"
            autoFocus
            className="flex-1 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-[15px] text-slate-100 placeholder:text-slate-600 focus:border-sky-400/60 focus:outline-none"
          />
          <button type="submit" className="rounded-xl bg-sky-500 px-5 py-3 text-sm font-extrabold text-white hover:bg-sky-400">
            ADD
          </button>
        </form>
      )}
    </div>
  );
}
