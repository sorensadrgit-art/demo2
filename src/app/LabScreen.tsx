import { useState } from 'react';
import CameraCapture from '../features/capture/CameraCapture';
import VideoCapture from '../features/capture/VideoCapture';
import DeviceSelector from '../features/capture/DeviceSelector';
import TargetSelector from '../features/tracking/TargetSelector';
import TrackingStatus from '../features/tracking/TrackingStatus';
import ROMPanel from '../features/rom/ROMPanel';
import MotionTimeline from '../features/timeline/MotionTimeline';
import CalibrationFlow from '../features/calibration/CalibrationFlow';
import SymmetryPanel from './SymmetryPanel';
import BodyScene from '../features/three/BodyScene';
import { useSession } from '../stores/sessionStore';
import { useUI } from '../stores/uiStore';
import { perfMonitor } from '../lib/performance/perf';
import { useEffect } from 'react';

/** Primary workspace: ~70% live analysis view + instrument rail + timeline. */
export default function LabScreen() {
  const sourceMode = useSession((s) => s.sourceMode);
  const appMode = useSession((s) => s.appMode);
  const set = useSession((s) => s.set);
  const repCount = useSession((s) => s.repCount);
  const leftPanel = useUI((s) => s.leftPanel);
  const setUI = useUI((s) => s.set);
  const toggle = useUI((s) => s.toggle);
  const show3D = useUI((s) => s.show3D);
  const showTrails = useUI((s) => s.showTrails);
  const showCOM = useUI((s) => s.showCOM);
  const showVectors = useUI((s) => s.showVectors);
  const [calibrating, setCalibrating] = useState(false);
  const [perf, setPerf] = useState({ inferenceFps: 0, renderFps: 0, droppedFrames: 0, lastLatencyMs: 0, avgLatencyMs: 0 });

  useEffect(() => {
    const id = setInterval(() => setPerf(perfMonitor.snapshot()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Top command bar (brand + mode nav live in the persistent shell header) */}
      <header className="no-print flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/60 px-4 py-2">
        <div className="flex items-center gap-2">
          <TargetSelector />
          <span className="hidden font-mono text-[10px] text-slate-500 lg:inline" title="Inference FPS / Render FPS / latency">
            INF {perf.inferenceFps} · RND {perf.renderFps} · {perf.lastLatencyMs}ms · DROP {perf.droppedFrames}
          </span>
          <span className="rounded bg-white/5 px-2 py-1 font-mono text-[11px] text-slate-300 ring-1 ring-white/10">REPS {repCount}</span>
          <button onClick={() => setCalibrating(!calibrating)} className="rounded bg-white/5 px-2.5 py-1 text-[11px] font-bold text-slate-200 ring-1 ring-white/15 hover:bg-white/10">
            CALIBRATE
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Main analysis view: 65-75% */}
        <main className="relative min-h-[46vh] flex-1 lg:min-h-0 lg:basis-[70%]" aria-label="Live analysis">
          {sourceMode === 'upload' ? <CameraCapture key="up" /> : <CameraCapture />}
          {sourceMode === 'upload' && (
            <div className="absolute inset-0"><VideoCapture /></div>
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-end justify-between gap-2">
            <div className="pointer-events-auto"><TrackingStatus /></div>
            <div className="pointer-events-auto flex gap-1.5" role="group" aria-label="Overlay toggles">
              {([['showTrails', 'TRAILS', showTrails], ['showCOM', 'COM', showCOM], ['showVectors', 'VECTORS', showVectors], ['show3D', '3D', show3D]] as const).map(([k, label, v]) => (
                <button
                  key={k}
                  onClick={() => toggle(k)}
                  aria-pressed={v}
                  className={`rounded px-2 py-1 text-[10px] font-bold tracking-widest ${v ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/50' : 'bg-black/60 text-slate-400 ring-1 ring-white/10'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </main>

        {/* Instrument rail */}
        <aside className="scroll-slim flex min-h-0 flex-col gap-3 overflow-y-auto border-t border-white/10 bg-[#060b13] p-3 lg:w-[30%] lg:min-w-[320px] lg:border-l lg:border-t-0" aria-label="Instruments">
          <div className="flex gap-1" role="tablist" aria-label="Side panel">
            {(['metrics', 'calibration', 'session'] as const).map((p) => (
              <button
                key={p}
                role="tab"
                aria-selected={leftPanel === p}
                onClick={() => setUI({ leftPanel: p })}
                className={`rounded px-2 py-1 text-[10px] font-bold tracking-widest ${leftPanel === p ? 'bg-white/10 text-slate-100' : 'text-slate-500'}`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          {calibrating || leftPanel === 'calibration' ? (
            <CalibrationFlow onDone={() => { setCalibrating(false); setUI({ leftPanel: 'metrics' }); }} />
          ) : null}
          {leftPanel === 'metrics' && !calibrating && <ROMPanel />}
          {leftPanel === 'session' && !calibrating && (
            <div className="flex flex-col gap-3">
              <DeviceSelector />
              <p className="text-[11px] leading-relaxed text-slate-500">
                Workflow: Select patient → body region → test → camera setup → calibration → target lock →
                record trial → analyze → review → save → compare → export.
              </p>
            </div>
          )}
          {appMode === 'symmetry' && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03]"><SymmetryPanel /></div>
          )}
          {show3D && (
            <div className="min-h-[320px] rounded-xl border border-white/10 bg-white/[0.03]">
              <BodyScene />
            </div>
          )}
          {/* Estimated kinetics — dashed, labeled, never solid. */}
          <KineticCard />
          {/* Sensor channel — solid treatment for measured data. */}
          <SensorCard />
        </aside>
      </div>

      {/* Precision timeline */}
      <div className="no-print">
        <MotionTimeline />
      </div>
    </div>
  );
}

function KineticCard() {
  const kineticSamples = useSession((s) => s.kineticSamples);
  const last = [...kineticSamples].reverse().find((k) => k.kind === 'jointMoment');
  const load = [...kineticSamples].reverse().find((k) => k.kind === 'loadingDistribution');
  return (
    <section aria-label="Estimated kinetics" className="rounded-xl border border-dashed border-amber-400/50 bg-amber-500/[0.04] p-3">
      <h3 className="text-[10px] font-bold tracking-[0.2em] text-amber-200">KINETICS · ESTIMATED</h3>
      {last ? (
        <p className="mt-1 font-mono text-sm text-amber-100">
          Knee moment ≈ {last.value.toFixed(1)} N·m <span className="text-[10px]">(EST · {last.modelSource} · conf {Math.round(last.confidence * 100)}%)</span>
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-amber-200/60">Flex the knee to generate model estimates.</p>
      )}
      {load && (
        <p className="mt-0.5 font-mono text-[11px] text-amber-100/80">Loading L/R ≈ {load.value.toFixed(0)}% / {(100 - load.value).toFixed(0)}% (EST)</p>
      )}
    </section>
  );
}

function SensorCard() {
  const sensorSamples = useSession((s) => s.sensorSamples);
  const last = sensorSamples[sensorSamples.length - 1];
  const [connected, setConnected] = useState(false);
  return (
    <section aria-label="Measured force" className="rounded-xl border border-emerald-400/30 bg-emerald-500/[0.05] p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-bold tracking-[0.2em] text-emerald-200">FORCE · MEASURED</h3>
        <button
          onClick={async () => {
            const { SimulatedSensorProvider, sensorBus } = await import('../features/kinetics/sensorProvider');
            const prov = new SimulatedSensorProvider('SIM-FP-01');
            if (!connected) {
              await prov.connect();
              prov.onSample((sn) => {
                sensorBus.publish({
                  deviceTimeMs: sn.t, sessionNow: performance.now(),
                  deviceId: sn.deviceId, sensorType: sn.sensorType,
                  value: sn.value, unit: sn.unit, confidence: sn.confidence, sampleRate: sn.sampleRate,
                });
                const cur = useSession.getState().sensorSamples;
                useSession.getState().set({ sensorSamples: [...cur.slice(-1200), { ...sn, t: performance.now() }] });
              });
              (window as unknown as { __simProv?: unknown }).__simProv = prov;
              setConnected(true);
            } else {
              await (window as unknown as { __simProv?: { disconnect(): Promise<void> } }).__simProv?.disconnect();
              setConnected(false);
            }
          }}
          className="rounded bg-emerald-500/20 px-2 py-1 text-[10px] font-bold text-emerald-200 ring-1 ring-emerald-400/40"
        >
          {connected ? 'DISCONNECT SIM PLATE' : 'CONNECT SIM PLATE'}
        </button>
      </div>
      {last ? (
        <p className="mt-1 font-mono text-sm text-emerald-100">
          ▬ {last.value.toFixed(1)} {last.unit} <span className="text-[10px] text-emerald-200/70">· {last.deviceId} · {last.sampleRate}Hz</span>
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-emerald-200/60">No hardware connected. A webcam cannot measure force.</p>
      )}
    </section>
  );
}
