import { useEffect, useState } from 'react';
import { biomechClient, type BackendHealth } from '../services/biomechanics/client';
import { EXPERIMENTAL_DISCLAIMER } from './config';

export type BackendState =
  | { kind: 'checking' }
  | { kind: 'unreachable'; reason: string }
  | { kind: 'ok'; health: BackendHealth };

/** Poll backend health; shared degraded-Precision source of truth for the UI. */
export function useBackendStatus(pollMs = 15000): BackendState {
  const [state, setState] = useState<BackendState>({ kind: 'checking' });
  useEffect(() => {
    let live = true;
    const check = async () => {
      try {
        const health = await biomechClient.health();
        if (live) setState({ kind: 'ok', health });
      } catch (e) {
        if (live) setState({ kind: 'unreachable', reason: e instanceof Error ? e.message : String(e) });
      }
    };
    void check();
    const id = window.setInterval(check, pollMs);
    return () => { live = false; window.clearInterval(id); };
  }, [pollMs]);
  return state;
}

/** Actionable degraded banner: realtime stays available, Precision suspends. */
export function BackendBanner({ state }: { state: BackendState }): JSX.Element | null {
  if (state.kind !== 'unreachable') return null;
  return (
    <div className="border-b border-amber-400/30 bg-amber-500/10 px-4 py-2 text-[12px] text-amber-100" role="status">
      <strong>Precision analysis unavailable</strong> — the biomechanics backend is unreachable
      ({state.reason}). Realtime assessment remains available. Precision measurements are
      suspended, never silently downgraded.
    </div>
  );
}

/** Precision suspension explainer for RTMW/OpenSim outages. */
export function PrecisionSuspended({ code, detail }: { code: string; detail?: string }): JSX.Element {
  const human: Record<string, string> = {
    POSE_PROVIDER_UNAVAILABLE: 'The pose provider (RTMW) is unavailable, so this Precision job was suspended.',
    BIOMECHANICAL_MODEL_UNAVAILABLE: 'The biomechanical model (OpenSim) did not execute, so no model-based measurement is reported.',
    ANATOMICAL_SIDE_UNRESOLVED: 'Anatomical identity could not be resolved, so measurement is suspended rather than guessed.',
    POLARITY_AMBIGUOUS: 'Left/right identity is ambiguous, so measurement is suspended rather than guessed.',
  };
  return (
    <div className="rounded border border-sky-400/30 bg-sky-500/10 p-3 text-[12px] text-sky-100" role="status">
      <p><strong>Precision suspended ({code}).</strong> {human[code] ?? 'This measurement was suspended by a safety gate.'}</p>
      {detail && <p className="mt-1 text-sky-200/80">{detail}</p>}
      <p className="mt-1 text-sky-200/70">{EXPERIMENTAL_DISCLAIMER}</p>
    </div>
  );
}
