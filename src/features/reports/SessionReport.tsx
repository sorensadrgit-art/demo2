import { useState } from 'react';
import { useSession } from '../../stores/sessionStore';
import { usePatients } from '../../stores/patientStore';
import { JOINT_DEFS } from '../biomechanics/jointAngles';
import { timelineToCSV, downloadText, sessionToJSON } from './exportCSV';
import { ESTIMATED_DISCLAIMER } from '../kinetics/kineticsTypes';

/** Professional session report: identifiers, config, ROM, symmetry, flags, confidence, exports. */
export default function SessionReport() {
  const s = useSession();
  const patient = usePatients((st) => st.activePatient());
  const base = usePatients((st) => st.baseline());
  const [notes, setNotes] = useState('');
  const def = JOINT_DEFS[s.activeJoint];
  const vals = s.timeline.map((p) => p.angles[s.activeJoint]).filter(Number.isFinite) as number[];
  const peak = vals.length ? Math.max(...vals) : NaN;
  const excursion = vals.length ? Math.max(...vals) - Math.min(...vals) : NaN;
  const joints = Object.keys(JOINT_DEFS) as Array<keyof typeof JOINT_DEFS>;

  const payload = {
    patientId: patient.id,
    assessment: s.session.movementId,
    date: new Date().toISOString(),
    joint: def.label,
    camera: s.session.cameraPlane,
    rom: { peak, excursion },
    reps: s.repCount,
    symmetry: 'see bilateral panel',
    compensations: s.compensations,
    sensorSamples: s.sensorSamples.length,
    estimatedKinetics: s.kineticSamples.length,
    confidence: s.liveLevel,
    baseline: base,
    notes,
    disclaimer: 'Camera-derived measures are experimental and not medically validated.',
  };

  return (
    <div className="mx-auto max-w-3xl p-5">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <p className="text-[11px] font-bold tracking-[0.24em] text-slate-400">SESSION REPORT</p>
        <h2 className="mt-1 text-xl font-bold text-slate-50">{patient.name} · {def.label} · {new Date().toLocaleDateString()}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-2 font-mono text-[13px] text-slate-200 sm:grid-cols-3">
          {([
            ['Patient', patient.id],
            ['Assessment', s.session.movementId],
            ['Camera', s.session.cameraPlane],
            ['Peak', Number.isFinite(peak) ? `${peak.toFixed(1)}°` : '—'],
            ['Excursion', Number.isFinite(excursion) ? `${excursion.toFixed(1)}°` : '—'],
            ['Reps', `${s.repCount}`],
            ['Confidence', s.liveLevel],
            ['Baseline Δ', base && Number.isFinite(peak) ? `${(peak - base.peak) >= 0 ? '+' : ''}${(peak - base.peak).toFixed(1)}°` : '—'],
            ['Sensor samples', `${s.sensorSamples.length}`],
          ] as Array<[string, string]>).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
              <dt className="font-sans text-[10px] tracking-widest text-slate-500">{k.toUpperCase()}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {s.compensations.length > 0 && (
          <div className="mt-4">
            <h3 className="text-[11px] font-bold tracking-[0.2em] text-slate-400">COMPENSATION FINDINGS</h3>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-rose-200">
              {s.compensations.slice(-6).map((c, i) => (
                <li key={i}>⚠ {c.label} — {c.detail} (confidence: {c.confidence})</li>
              ))}
            </ul>
          </div>
        )}

        {s.kineticSamples.length > 0 && (
          <p className="mt-4 rounded-lg border border-dashed border-amber-400/50 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
            ESTIMATED kinetics present ({s.kineticSamples.length} samples). {ESTIMATED_DISCLAIMER}
          </p>
        )}

        <label className="mt-4 block text-[11px] tracking-widest text-slate-500">CLINICIAN NOTES
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm normal-case tracking-normal text-slate-100"
            placeholder="Objective observations, plan…"
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => downloadText(`kinelab-${patient.id}-${Date.now()}.csv`, timelineToCSV(s.timeline, joints), 'text/csv')}
            className="rounded bg-sky-500/20 px-4 py-2 text-xs font-bold text-sky-200 ring-1 ring-sky-400/40"
          >
            EXPORT CSV
          </button>
          <button
            onClick={() => downloadText(`kinelab-${patient.id}-${Date.now()}.json`, sessionToJSON(payload), 'application/json')}
            className="rounded bg-sky-500/20 px-4 py-2 text-xs font-bold text-sky-200 ring-1 ring-sky-400/40"
          >
            EXPORT JSON
          </button>
          <button onClick={() => window.print()} className="rounded bg-white/5 px-4 py-2 text-xs font-bold text-slate-200 ring-1 ring-white/15">
            PRINT / PDF (BROWSER)
          </button>
        </div>
        <p className="mt-3 text-[10px] text-slate-600">Raw video is stored separately from derived metrics and only when recording is opted in. Local-Only Mode keeps all processing on this device.</p>
      </div>
    </div>
  );
}
