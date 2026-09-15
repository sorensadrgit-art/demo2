import { useEffect, useRef, useState } from 'react';
import { frameStore } from '../visualization/frameStore';
import { perfMonitor } from '../../lib/performance/perf';
import { useSession } from '../../stores/sessionStore';
import type { SoloViewClass, ViewQuality } from './viewClassifier';
import type { SoloQualityState } from './qualityEngine';
import type { SuspensionReason } from './suspension';

/**
 * Real-camera Solo V6.3 validation harness — DEV ONLY, never production UI.
 *
 * Mounted only when `?soloValidate=1` is active in the URL (gated: dev builds or
 * VITE_E2E_MODE=true; production ignores it).
 *
 * Exposes live single-RGB telemetry:
 *   camera · FPS · provider · view classification · landmark visibility ·
 *   raw vs filtered clinical angle · quality state · suspension reason
 *
 * Clinical accuracy: NO (Public Research Preview).
 * Deidentified metrics only — no facial embeddings, biometrics, or raw video stored.
 */

export interface SoloSample {
  t: number;
  camera: string;
  infFps: number;
  renderFps: number;
  provider: string;
  view: SoloViewClass;
  viewQuality: ViewQuality;
  landmarkVisRatio: number;
  visibleLandmarkCount: number;
  totalLandmarks: number;
  rawAngle: number;
  filteredAngle: number;
  angleDiff: number;
  qualityState: SoloQualityState;
  liveLevel: string;
  suspension: SuspensionReason | null;
  coachCue: string | null;
}

export function soloValidateRouteActive(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('soloValidate') !== '1' && !params.has('soloValidate')) return false;
  if (import.meta.env.PROD && import.meta.env.VITE_E2E_MODE !== 'true') return false;
  if (!import.meta.env.DEV && import.meta.env.VITE_E2E_MODE !== 'true') return false;
  return true;
}

export default function SoloValidationPanel() {
  const [, force] = useState(0);
  const logRef = useRef<SoloSample[]>([]);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');

  const session = useSession();
  const cameraMeta = session.cameraMeta;
  const soloView = session.soloView;
  const soloViewQuality = session.soloViewQuality;
  const soloQualityState = session.soloQualityState;
  const soloSuspension = session.soloSuspension;
  const soloCoach = session.soloCoach;
  const liveRawAngle = session.liveRawAngle;
  const liveFilteredAngle = session.liveFilteredAngle;
  const liveLevel = session.liveLevel;
  const sourceMode = session.sourceMode;

  const providerName = sourceMode === 'demo' ? 'DemoSynthesis' : 'MediaPipePoseProvider (Single RGB)';

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const now = performance.now();
      const perf = perfMonitor.snapshot();
      const f = frameStore;
      const lms = f.landmarks ?? [];
      const totalLandmarks = lms.length;
      const visCount = lms.filter((l) => (l.visibility ?? 0) >= 0.4).length;
      const landmarkVisRatio = totalLandmarks > 0 ? visCount / totalLandmarks : 0;

      const raw = useSession.getState().liveRawAngle;
      const filt = useSession.getState().liveFilteredAngle;
      const diff = Number.isFinite(raw) && Number.isFinite(filt) ? filt - raw : NaN;

      const camDesc = cameraMeta.label
        ? `${cameraMeta.label} (${cameraMeta.width}x${cameraMeta.height} @ ${cameraMeta.fps || 30}fps)`
        : `Webcam (${cameraMeta.width || 640}x${cameraMeta.height || 480})`;

      logRef.current.push({
        t: now,
        camera: camDesc,
        infFps: perf.inferenceFps,
        renderFps: perf.renderFps,
        provider: providerName,
        view: useSession.getState().soloView,
        viewQuality: useSession.getState().soloViewQuality,
        landmarkVisRatio,
        visibleLandmarkCount: visCount,
        totalLandmarks,
        rawAngle: raw,
        filteredAngle: filt,
        angleDiff: diff,
        qualityState: useSession.getState().soloQualityState,
        liveLevel: useSession.getState().liveLevel,
        suspension: useSession.getState().soloSuspension,
        coachCue: useSession.getState().soloCoach,
      });

      if (logRef.current.length > 3600) logRef.current.shift();
      force((n) => n + 1);
    }, 500);

    return () => window.clearInterval(id);
  }, [running, cameraMeta, providerName]);

  const exportLog = () => {
    const rows = logRef.current;
    const validAngleRows = rows.filter((r) => Number.isFinite(r.rawAngle) && Number.isFinite(r.filteredAngle));
    const avgDiff = validAngleRows.length
      ? validAngleRows.reduce((acc, r) => acc + Math.abs(r.angleDiff), 0) / validAngleRows.length
      : 0;

    const summary = {
      scenario: note || 'unnamed-solo-validation',
      clinicalAccuracy: 'NO',
      disclaimer: 'Public Research Preview. Single RGB camera screen-plane estimation. Not a medical device.',
      samples: rows.length,
      camera: rows.length ? rows[rows.length - 1].camera : 'unknown',
      provider: providerName,
      avgInfFps: rows.length ? rows.reduce((a, r) => a + r.infFps, 0) / rows.length : 0,
      avgRenderFps: rows.length ? rows.reduce((a, r) => a + r.renderFps, 0) / rows.length : 0,
      avgLandmarkVis: rows.length ? rows.reduce((a, r) => a + r.landmarkVisRatio, 0) / rows.length : 0,
      meanAbsAngleFilterDiffDeg: avgDiff,
      finalQualityState: rows.length ? rows[rows.length - 1].qualityState : 'UNKNOWN',
      finalSuspension: rows.length ? rows[rows.length - 1].suspension : null,
      finalView: rows.length ? rows[rows.length - 1].view : 'UNKNOWN',
    };

    const blob = new Blob([JSON.stringify({ summary, rows }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `solo-webcam-validation-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const perf = perfMonitor.snapshot();
  const lms = frameStore.landmarks ?? [];
  const totalLms = lms.length;
  const visibleLms = lms.filter((l) => (l.visibility ?? 0) >= 0.4).length;
  const visRatio = totalLms > 0 ? (visibleLms / totalLms) * 100 : 0;

  const rawDisplay = Number.isFinite(liveRawAngle) ? `${liveRawAngle.toFixed(1)}°` : '—';
  const filtDisplay = Number.isFinite(liveFilteredAngle) ? `${liveFilteredAngle.toFixed(1)}°` : '—';
  const diffVal = Number.isFinite(liveRawAngle) && Number.isFinite(liveFilteredAngle)
    ? liveFilteredAngle - liveRawAngle
    : null;
  const diffDisplay = diffVal !== null ? `${diffVal >= 0 ? '+' : ''}${diffVal.toFixed(1)}°` : '—';

  const cameraDesc = cameraMeta.label
    ? `${cameraMeta.label} (${cameraMeta.width}x${cameraMeta.height} @ ${cameraMeta.fps || 30}fps)`
    : `Webcam (${cameraMeta.width || 640}x${cameraMeta.height || 480})`;

  return (
    <section aria-label="Solo webcam validation harness" className="rounded-xl border border-emerald-400/40 bg-black/80 p-4 text-xs text-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold tracking-[0.24em] text-emerald-300">
          DEV ONLY · SOLO WEBCAM VALIDATION (V6.3)
        </p>
        <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-300 ring-1 ring-rose-500/30">
          Clinical Accuracy: NO · Public Research Preview
        </span>
      </div>
      <p className="mt-1 text-slate-400">
        Real-time telemetry for single-RGB camera pose, view classification, raw vs filtered angles, and suspension gating. Ordinary Focus mode excludes this panel.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Validation label, e.g. Knee-left-sagittal-01"
          aria-label="Validation session label"
          className="w-64 rounded bg-white/5 px-2 py-1 ring-1 ring-white/15 focus:outline-none focus:ring-2 focus:ring-emerald-400"
        />
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          aria-label={running ? 'Stop recording validation data' : 'Start recording validation data'}
          className="rounded bg-emerald-500/90 px-3 py-1 font-bold text-black hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          {running ? 'STOP RECORDING' : 'START RECORDING'}
        </button>
        <button
          type="button"
          onClick={exportLog}
          disabled={!logRef.current.length}
          aria-label="Export validation log as JSON"
          className="rounded bg-white/10 px-3 py-1 ring-1 ring-white/15 hover:bg-white/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          EXPORT JSON ({logRef.current.length})
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-mono sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">camera</dt>
          <dd className="truncate text-slate-200" title={cameraDesc}>{cameraDesc}</dd>
        </div>
        <div>
          <dt className="text-slate-500">inf / render fps</dt>
          <dd className="text-slate-200">{perf.inferenceFps.toFixed(0)} / {perf.renderFps.toFixed(0)} fps</dd>
        </div>
        <div>
          <dt className="text-slate-500">provider</dt>
          <dd className="truncate text-slate-200" title={providerName}>{providerName}</dd>
        </div>
        <div>
          <dt className="text-slate-500">view</dt>
          <dd className="text-slate-200">
            {soloView} <span className="text-[10px] text-slate-400">({soloViewQuality})</span>
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">landmark visibility</dt>
          <dd className="text-slate-200">
            {visRatio.toFixed(0)}% <span className="text-[10px] text-slate-400">({visibleLms}/{totalLms || 33})</span>
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">raw vs filtered angle</dt>
          <dd className="text-slate-200">
            {rawDisplay} → {filtDisplay} <span className="text-[10px] text-slate-400">({diffDisplay})</span>
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">quality / confidence</dt>
          <dd className="text-slate-200">
            {soloQualityState} <span className="text-[10px] text-slate-400">({liveLevel})</span>
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">suspension reason</dt>
          <dd className={soloSuspension ? 'font-bold text-amber-300' : 'text-slate-200'}>
            {soloSuspension ?? 'NONE'}
          </dd>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <dt className="text-slate-500">coach cue</dt>
          <dd className="text-sky-300">{soloCoach || '—'}</dd>
        </div>
      </dl>
    </section>
  );
}
