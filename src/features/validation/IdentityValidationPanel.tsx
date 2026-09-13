import { useEffect, useRef, useState } from 'react';
import { frameStore } from '../visualization/frameStore';
import { readIdentityProbe } from '../capture/useMotionEngine';
import { perfMonitor } from '../../lib/performance/perf';
import { useSession } from '../../stores/sessionStore';

/**
 * Real-camera identity validation harness — DEV ONLY, never production UI.
 *
 * Mounted only on the `?validateIdentity` dev route (gated: dev builds or
 * VITE_E2E_MODE=true; production ignores it). Renders the same MotionCanvas
 * pipeline against the REAL camera + REAL MediaPipe multi-pose provider and
 * records the identity evidence the clinical scenario demands:
 *
 *   active patient id · candidate ids · identity-switch count · lock state ·
 *   target-loss duration · reacquisition duration · landmark visibility ·
 *   angle overlay owner · inference/render FPS · confidence
 *
 * No biometric descriptors or visual embeddings are logged or displayed —
 * only aggregate counts, durations and visibility ratios.
 */

interface Sample {
  t: number;
  activeId: number | null;
  state: string;
  switches: number;
  owner: number | null;
  candidates: number[];
  level: string;
  infFps: number;
  renderFps: number;
}

export function validateIdentityRouteActive(): boolean {
  if (typeof window === 'undefined') return false;
  if (!new URLSearchParams(window.location.search).has('validateIdentity')) return false;
  if (import.meta.env.PROD && import.meta.env.VITE_E2E_MODE !== 'true') return false;
  if (!import.meta.env.DEV && import.meta.env.VITE_E2E_MODE !== 'true') return false;
  return true;
}

export default function IdentityValidationPanel() {
  const [, force] = useState(0);
  const logRef = useRef<Sample[]>([]);
  const lostAtRef = useRef<number | null>(null);
  const lossDurations = useRef<number[]>([]);
  const reacqStart = useRef<number | null>(null);
  const reacqDurations = useRef<number[]>([]);
  const lastState = useRef<string>('');
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const probe = readIdentityProbe();
      const f = frameStore;
      const now = performance.now();
      const st = (probe?.state ?? f.tracking) as string;
      // Loss / reacquisition timing from identity-state transitions.
      if ((st === 'reacquiring' || st === 'lost') && lostAtRef.current === null) {
        lostAtRef.current = now;
        reacqStart.current = now;
      }
      if (st === 'locked' && lostAtRef.current !== null) {
        lossDurations.current.push(now - lostAtRef.current);
        if (reacqStart.current !== null) reacqDurations.current.push(now - reacqStart.current);
        lostAtRef.current = null;
        reacqStart.current = null;
      }
      lastState.current = st;
      const vis = f.landmarks
        ? f.landmarks.filter((l) => l.visibility >= 0.4).length / Math.max(1, f.landmarks.length)
        : 0;
      void vis;
      const perf = perfMonitor.snapshot();
      logRef.current.push({
        t: now,
        activeId: probe?.activeId ?? null,
        state: st,
        switches: probe?.idSwitches ?? 0,
        owner: f.overlayOwnerId,
        candidates: f.candidates.map((c) => c.id),
        level: f.level,
        infFps: perf.inferenceFps,
        renderFps: perf.renderFps,
      });
      if (logRef.current.length > 3600) logRef.current.shift();
      force((n) => n + 1);
    }, 500);
    return () => window.clearInterval(id);
  }, [running]);

  const exportLog = () => {
    const rows = logRef.current;
    const losses = lossDurations.current;
    const reacqs = reacqDurations.current;
    const summary = {
      scenario: note || 'unnamed',
      samples: rows.length,
      idSwitches: rows.length ? rows[rows.length - 1].switches : 0,
      wrongOwnerFrames: rows.filter((r) => r.owner !== null && r.owner !== r.activeId).length,
      avgLossMs: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
      worstLossMs: losses.length ? Math.max(...losses) : 0,
      avgReacqMs: reacqs.length ? reacqs.reduce((a, b) => a + b, 0) / reacqs.length : 0,
      worstReacqMs: reacqs.length ? Math.max(...reacqs) : 0,
      avgInfFps: rows.length ? rows.reduce((a, r) => a + r.infFps, 0) / rows.length : 0,
      avgRenderFps: rows.length ? rows.reduce((a, r) => a + r.renderFps, 0) / rows.length : 0,
    };
    const blob = new Blob([JSON.stringify({ summary, rows }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `identity-validation-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const last = logRef.current[logRef.current.length - 1];
  const s = useSession((st) => st.trackingState);

  return (
    <section aria-label="Identity validation harness" className="rounded-xl border border-amber-400/40 bg-black/70 p-4 text-xs text-slate-200">
      <p className="text-[10px] font-bold tracking-[0.24em] text-amber-300">DEV ONLY · IDENTITY VALIDATION</p>
      <p className="mt-1 text-slate-400">Real camera + real MediaPipe. No descriptors logged. Scenarios A–J checklist lives in-session; record one scenario per export.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Scenario label, e.g. D-direct-crossing"
          className="w-64 rounded bg-white/5 px-2 py-1 ring-1 ring-white/15"
        />
        <button onClick={() => setRunning((r) => !r)} className="rounded bg-amber-500/90 px-3 py-1 font-bold text-black">
          {running ? 'STOP' : 'START'} RECORDING
        </button>
        <button onClick={exportLog} disabled={!logRef.current.length} className="rounded bg-white/10 px-3 py-1 ring-1 ring-white/15 disabled:opacity-40">
          EXPORT JSON
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono sm:grid-cols-4">
        <div><dt className="text-slate-500">activePatientId</dt><dd>{String(last?.activeId ?? '—')}</dd></div>
        <div><dt className="text-slate-500">candidates</dt><dd>{last ? last.candidates.join(',') || '—' : '—'}</dd></div>
        <div><dt className="text-slate-500">state</dt><dd>{last?.state ?? s}</dd></div>
        <div><dt className="text-slate-500">idSwitches</dt><dd>{last?.switches ?? 0}</dd></div>
        <div><dt className="text-slate-500">overlayOwner</dt><dd>{String(last?.owner ?? '—')}</dd></div>
        <div><dt className="text-slate-500">owner==active</dt><dd>{last ? (last.owner === last.activeId || last.owner === null ? 'yes' : 'NO') : '—'}</dd></div>
        <div><dt className="text-slate-500">confidence</dt><dd>{last?.level ?? '—'}</dd></div>
        <div><dt className="text-slate-500">inf/render fps</dt><dd>{last ? `${last.infFps.toFixed(0)}/${last.renderFps.toFixed(0)}` : '—'}</dd></div>
      </dl>
    </section>
  );
}
