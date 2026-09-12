import { useState } from 'react';
import { frameStore } from '../visualization/frameStore';
import { assessCalibrationQuality, captureReference, type CalibrationConfig } from './calibrationEngine';
import { checkFraming, recommendPlane } from './cameraAlignment';
import { listExercises } from '../exercises/exerciseRegistry';
import { useSession } from '../../stores/sessionStore';

/** Short pre-measurement calibration: neutral pose → quality score → reference. */
export default function CalibrationFlow({ onDone }: { onDone: () => void }) {
  const session = useSession((s) => s.session);
  const set = useSession((s) => s.set);
  const [form, setForm] = useState<CalibrationConfig>({
    patientHeightCm: 172,
    affectedSide: session.affectedSide,
    movementId: session.movementId,
    cameraPlane: session.cameraPlane,
    sensorIds: [],
  });
  const [step, setStep] = useState(0);

  const quality = assessCalibrationQuality(frameStore.landmarks, 0.7);
  const framing = checkFraming(frameStore.landmarks, 1280, 720);
  const rec = recommendPlane(form.movementId);

  const capture = () => {
    if (!frameStore.landmarks) return;
    const res = captureReference(frameStore.landmarks, form, 0.7, performance.now());
    set({
      calibQuality: res.quality.score,
      session: { ...session, movementId: form.movementId, cameraPlane: form.cameraPlane, affectedSide: form.affectedSide },
    });
    onDone();
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4" role="dialog" aria-label="Calibration">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold tracking-[0.2em] text-slate-300">CALIBRATION · STEP {step + 1}/3</h3>
        <span className={`font-mono text-xs font-bold ${quality.score >= 0.75 ? 'text-emerald-300' : quality.score >= 0.5 ? 'text-amber-300' : 'text-rose-300'}`}>
          QUALITY {Math.round(quality.score * 100)}%
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-white/10">
        <div className="h-full bg-sky-400 transition-all" style={{ width: `${quality.score * 100}%` }} />
      </div>

      {step === 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <label className="flex flex-col gap-1 text-slate-400">HEIGHT (CM)
            <input type="number" value={form.patientHeightCm} onChange={(e) => setForm({ ...form, patientHeightCm: Number(e.target.value) })} className="rounded border border-white/10 bg-black/50 px-2 py-1.5 text-slate-100" />
          </label>
          <label className="flex flex-col gap-1 text-slate-400">AFFECTED SIDE
            <select value={form.affectedSide} onChange={(e) => setForm({ ...form, affectedSide: e.target.value as CalibrationConfig['affectedSide'] })} className="rounded border border-white/10 bg-black/50 px-2 py-1.5 text-slate-100">
              <option value="left">Left</option><option value="right">Right</option>
              <option value="bilateral">Bilateral</option><option value="na">N/A</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-slate-400">MOVEMENT
            <select value={form.movementId} onChange={(e) => {
              const movementId = e.target.value;
              const r = recommendPlane(movementId);
              setForm({ ...form, movementId, cameraPlane: r.plane });
            }} className="rounded border border-white/10 bg-black/50 px-2 py-1.5 text-slate-100">
              {listExercises().map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-slate-400">CAMERA VIEW
            <select value={form.cameraPlane} onChange={(e) => setForm({ ...form, cameraPlane: e.target.value as 'sagittal' | 'frontal' })} className="rounded border border-white/10 bg-black/50 px-2 py-1.5 text-slate-100">
              <option value="sagittal">Sagittal (side)</option><option value="frontal">Frontal (front)</option>
            </select>
          </label>
          <p className="col-span-2 text-[11px] text-sky-300/90">{rec.hint}</p>
        </div>
      )}

      {step === 1 && (
        <div className="mt-3 text-xs text-slate-300">
          <p className="font-semibold text-slate-100">Stand in neutral anatomical pose: feet together, arms relaxed, facing {form.cameraPlane === 'sagittal' ? 'sideways to' : ''} the camera.</p>
          <ul className="mt-2 flex flex-col gap-1" aria-live="polite">
            {quality.blockers.length === 0 && framing.length === 0
              ? <li className="text-emerald-300">✓ Ready — full body visible, framing good.</li>
              : [...quality.blockers, ...framing.map((f) => f.message)].map((b) => (
                <li key={b} className="font-semibold text-amber-300">! {b}</li>
              ))}
          </ul>
        </div>
      )}

      {step === 2 && (
        <div className="mt-3 text-xs text-slate-300">
          <p>Reference state establishes body proportions and the neutral baseline for excursion. Floor-plane calibration is optional and skipped for seated tasks.</p>
          <p className="mt-2 text-slate-500">Body mass improves estimated-kinetics confidence; it never affects measured angles.</p>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {step > 0 && <button onClick={() => setStep(step - 1)} className="rounded bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-white/10">BACK</button>}
        {step < 2
          ? <button onClick={() => setStep(step + 1)} className="rounded bg-sky-500/20 px-3 py-1.5 text-xs font-bold text-sky-200 ring-1 ring-sky-400/40">CONTINUE</button>
          : <button onClick={capture} className="rounded bg-emerald-500 px-4 py-1.5 text-xs font-bold text-white">CAPTURE REFERENCE</button>}
        <button onClick={onDone} className="ml-auto text-[11px] text-slate-500 underline">Skip for now</button>
      </div>
    </div>
  );
}
