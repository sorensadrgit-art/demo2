import LabScreen from './LabScreen';
import FocusShell from '../features/focus/FocusShell';
import { useFocus } from '../features/focus/focusStore';
import GoniometerMode from '../features/rom/GoniometerMode';
import SessionReport from '../features/reports/SessionReport';
import PatientDashboard from '../features/patients/PatientDashboard';
import SessionComparison from '../features/patients/SessionComparison';
import BodyScene from '../features/three/BodyScene';
import AnalysisWorkspace from '../analysis/AnalysisWorkspace';
import SymmetryPanel from './SymmetryPanel';
import { useSession } from '../stores/sessionStore';
import { useUI } from '../stores/uiStore';

/** Session workflow rail: patient → region → test → setup → calibrate → lock → record → analyze → compare → export. */
const WORKFLOW = [
  'Select/Create Patient', 'Body Region', 'Test', 'Camera Setup',
  'Calibration', 'Target Lock', 'Record Trial', 'Analyze',
  'Review', 'Save', 'Compare', 'Export',
];

export default function App() {
  const appMode = useSession((s) => s.appMode);
  const set = useSession((s) => s.set);
  const localOnly = useUI((s) => s.localOnly);
  const toggle = useUI((s) => s.toggle);
  const experience = useFocus((s) => s.experience);
  const setFocus = useFocus((s) => s.set);
  const inFocus = experience === 'focus';

  return (
    <div className="flex h-full flex-col bg-[#04070d] text-slate-100">
      <a href="#workspace" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-sky-500 focus:px-3 focus:py-1">
        Skip to workspace
      </a>
      {/* Persistent shell header: brand + mode nav always reachable */}
      <header className="no-print flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/60 px-4 py-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-extrabold tracking-[0.28em] text-slate-100">KINELAB</h1>
          <span className="hidden text-[10px] tracking-widest text-slate-500 sm:inline">MOTION ANALYSIS LABORATORY</span>
        </div>
        <div className="ml-2 flex flex-wrap items-center gap-1" role="group" aria-label="Experience">
          <button
            onClick={() => { setFocus({ experience: 'focus' }); set({ appMode: 'focus' }); }}
            aria-pressed={inFocus}
            className={`rounded px-2.5 py-1 text-[11px] font-extrabold tracking-widest ${inFocus ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/50' : 'text-slate-400 hover:text-slate-200'}`}
          >
            FOCUS
          </button>
          <button
            onClick={() => { setFocus({ experience: 'lab' }); if (appMode === 'focus') set({ appMode: 'measure' }); }}
            aria-pressed={!inFocus}
            className={`rounded px-2.5 py-1 text-[11px] font-bold tracking-widest ${!inFocus ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/50' : 'text-slate-400 hover:text-slate-200'}`}
          >
            LAB
          </button>
        </div>
        {!inFocus && (
        <nav className="ml-2 flex flex-wrap gap-1" aria-label="Mode">
          {([['measure', 'MEASURE'], ['goniometer', 'GONIOMETER'], ['symmetry', 'SYMMETRY'], ['analysis3d', '3D'], ['report', 'REPORT'], ['progress', 'PROGRESS']] as Array<[Exclude<typeof appMode, 'focus'>, string]>).map(([m, label]) => (
            <button
              key={m}
              onClick={() => set({ appMode: m })}
              className={`rounded px-2.5 py-1 text-[11px] font-bold tracking-widest ${appMode === m ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/50' : 'text-slate-400 hover:text-slate-200'}`}
              aria-pressed={appMode === m}
              title={m === 'analysis3d' ? 'Clinical analysis workspace: synchronized review, waveform, 3D, quality inspector' : undefined}
            >
              {label}
            </button>
          ))}
        </nav>
        )}
      </header>
      {/* Session workflow strip */}
      <div className="no-print flex items-center gap-1 overflow-x-auto border-b border-white/5 bg-black/40 px-3 py-1" aria-label="Session workflow">
        {WORKFLOW.map((w, i) => (
          <span key={w} className="flex shrink-0 items-center gap-1 text-[10px] tracking-wide text-slate-500">
            <span className={`flex h-4 w-4 items-center justify-center rounded-full font-mono ${i <= 5 ? 'bg-sky-500/25 text-sky-200' : 'bg-white/5 text-slate-500'}`}>{i + 1}</span>
            {w}{i < WORKFLOW.length - 1 && <span className="mx-1 text-slate-700">›</span>}
          </span>
        ))}
        <button
          onClick={() => toggle('localOnly')}
          aria-pressed={localOnly}
          className={`ml-auto shrink-0 rounded px-2 py-0.5 text-[10px] font-bold tracking-widest ${localOnly ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40' : 'bg-white/5 text-slate-400 ring-1 ring-white/10'}`}
          title="Local-Only Mode: no footage leaves this device"
        >
          {localOnly ? 'LOCAL-ONLY · ON' : 'LOCAL-ONLY · OFF'}
        </button>
      </div>

      <div id="workspace" className="min-h-0 flex-1">
        {(appMode === 'focus' || inFocus) && <FocusShell />}
        {appMode === 'measure' && !inFocus && <LabScreen />}
        {appMode === 'goniometer' && !inFocus && (
          <div className="h-full overflow-y-auto p-4">
            <BackButton />
            <GoniometerMode />
          </div>
        )}
        {appMode === 'symmetry' && !inFocus && (
          <div className="mx-auto h-full max-w-2xl overflow-y-auto">
            <div className="p-4"><BackButton /></div>
            <SymmetryPanel />
          </div>
        )}
        {appMode === 'analysis3d' && !inFocus && (
          <div className="h-full overflow-y-auto p-4">
            <BackButton />
            <div className="min-h-[calc(100%-40px)] rounded-2xl border border-white/10 bg-white/[0.02]">
              <AnalysisWorkspace />
            </div>
          </div>
        )}
        {appMode === 'report' && !inFocus && (
          <div className="h-full overflow-y-auto">
            <div className="p-4 pb-0"><BackButton /></div>
            <SessionReport />
          </div>
        )}
        {appMode === 'progress' && !inFocus && (
          <div className="mx-auto grid h-full max-w-5xl grid-cols-1 gap-3 overflow-y-auto p-4 md:grid-cols-2">
            <div className="col-span-1 md:col-span-2"><BackButton /></div>
            <div className="min-h-[300px] rounded-2xl border border-white/10 bg-white/[0.02]"><PatientDashboard /></div>
            <div className="min-h-[300px] rounded-2xl border border-white/10 bg-white/[0.02]"><SessionComparison /></div>
          </div>
        )}
      </div>

      <footer className="no-print border-t border-white/5 bg-black/50 px-4 py-1.5 text-[10px] text-slate-600">
        Camera-derived measures are experimental and not medically validated. Estimated kinetics are model-derived, never measured force. Recording is opt-in; raw video is stored separately from metrics.
      </footer>
    </div>
  );
}

function BackButton() {
  const set = useSession((s) => s.set);
  return (
    <button onClick={() => set({ appMode: 'measure' })} className="no-print mb-2 rounded bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300 ring-1 ring-white/10 hover:bg-white/10">
      ← BACK TO LAB
    </button>
  );
}

export function UnusedWorkflowRef() {
  void WORKFLOW;
  return null;
}
