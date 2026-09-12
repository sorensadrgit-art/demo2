import { useMemo, useRef, useState } from 'react';
import { useSession } from '../../stores/sessionStore';
import { JOINT_DEFS } from '../biomechanics/jointAngles';
import { ROMEngine, aggregateTrials, type ROMTrial } from './romEngine';
import { formatAngle } from '../biomechanics/confidence';

/** Dedicated single-joint measurement: Start → Hold → Reset → Save Trial. */
export default function GoniometerMode() {
  const activeJoint = useSession((s) => s.activeJoint);
  const liveAngle = useSession((s) => s.liveAngle);
  const liveVel = useSession((s) => s.liveVel);
  const liveLevel = useSession((s) => s.liveLevel);
  const trials = useSession((s) => s.trials);
  const set = useSession((s) => s.set);
  const engineRef = useRef<ROMEngine | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [held, setHeld] = useState(false);

  if (!engineRef.current || engineRef.current.joint !== activeJoint) {
    engineRef.current = new ROMEngine(activeJoint);
  }
  const engine = engineRef.current;

  useMemo(() => {
    if (measuring && !held) engine.push(performance.now(), liveAngle, liveVel, liveLevel !== 'suspended');
  }, [liveAngle, liveVel, liveLevel, measuring, held, engine]);

  const stats = engine.liveStats();
  const agg = aggregateTrials(trials.filter((t) => t.joint === activeJoint));

  const start = () => {
    engine.startMeasurement(performance.now(), Number.isFinite(liveAngle) ? liveAngle : 0);
    setMeasuring(true); setHeld(false);
  };
  const save = () => {
    const t: ROMTrial | null = engine.finishTrial(performance.now());
    if (t) set({ trials: [...useSession.getState().trials, t] });
    setMeasuring(false);
  };

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <p className="text-[11px] font-bold tracking-[0.24em] text-slate-400">DIGITAL GONIOMETER</p>
      <h2 className="mt-1 text-2xl font-bold text-slate-50">{JOINT_DEFS[activeJoint].label}</h2>
      <div className="mt-4 text-center font-mono text-7xl font-semibold tracking-tight text-slate-50">
        {formatAngle(liveAngle, liveLevel)}
      </div>
      {stats && (
        <dl className="mx-auto mt-5 grid max-w-xl grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-3">
          {([
            ['Start', `${stats.start.toFixed(1)}°`],
            ['Peak', `${stats.max.toFixed(1)}°`],
            ['ROM', `${stats.excursion.toFixed(1)}°`],
            ['Peak velocity', `${stats.peakVelocity.toFixed(1)}°/s`],
            ['Trial duration', `${stats.duration.toFixed(1)} s`],
            ['Samples', `${stats.count}`],
          ] as Array<[string, string]>).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
              <dt className="font-sans text-[10px] tracking-widest text-slate-500">{k.toUpperCase()}</dt>
              <dd className="text-slate-100">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {!measuring ? (
          <button onClick={start} className="rounded-lg bg-sky-500 px-5 py-2 text-sm font-bold text-white hover:bg-sky-400">START MEASUREMENT</button>
        ) : (
          <>
            <button onClick={() => { held ? engine.resume() : engine.hold(); setHeld(!held); }} className="rounded-lg bg-amber-500/20 px-5 py-2 text-sm font-bold text-amber-200 ring-1 ring-amber-400/40">
              {held ? 'RESUME' : 'HOLD'}
            </button>
            <button onClick={() => { engine.reset(); setMeasuring(false); }} className="rounded-lg bg-white/5 px-5 py-2 text-sm font-bold text-slate-300 ring-1 ring-white/15">RESET</button>
            <button onClick={save} className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-400">SAVE TRIAL</button>
          </>
        )}
      </div>
      {trials.filter((t) => t.joint === activeJoint).length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full font-mono text-xs text-slate-300">
            <thead><tr className="text-left text-[10px] tracking-widest text-slate-500">
              <th className="pb-1">TRIAL</th><th>START</th><th>PEAK</th><th>ROM</th><th>PEAK VEL</th><th>DUR</th>
            </tr></thead>
            <tbody>
              {trials.filter((t) => t.joint === activeJoint).map((t, i) => (
                <tr key={t.id} className="border-t border-white/5">
                  <td className="py-1.5">#{i + 1}</td><td>{t.start.toFixed(1)}°</td><td>{t.peak.toFixed(1)}°</td>
                  <td>{t.excursion.toFixed(1)}°</td><td>{t.peakVelocity.toFixed(1)}°/s</td><td>{t.duration.toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
          {agg && agg.n > 1 && (
            <p className="mt-2 font-mono text-xs text-slate-400">
              MEAN PEAK {agg.meanPeak.toFixed(1)}° ± {agg.sdPeak.toFixed(1)}° · MEAN ROM {agg.meanExcursion.toFixed(1)}° ± {agg.sdExcursion.toFixed(1)}° · CHANGE {agg.changeVsFirst >= 0 ? '+' : ''}{agg.changeVsFirst.toFixed(1)}°
            </p>
          )}
        </div>
      )}
    </div>
  );
}
