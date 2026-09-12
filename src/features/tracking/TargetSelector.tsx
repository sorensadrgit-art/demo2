import { frameStore } from '../visualization/frameStore';
import { engineRefs } from '../capture/useMotionEngine';
import { sessionClock } from '../../lib/timing/timeSync';
import { useSession } from '../../stores/sessionStore';
import { useEffect, useState } from 'react';

export function useCandidates() {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(id);
  }, []);
  return frameStore.candidates;
}

export default function TargetSelector() {
  const candidates = useCandidates();
  const activeSubjectId = useSession((s) => s.activeSubjectId);
  const trackingState = useSession((s) => s.trackingState);

  if (candidates.length <= 1 && activeSubjectId !== null) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5" aria-live="polite">
      <span className={`text-[10px] font-bold tracking-widest ${trackingState === 'locked' ? 'text-emerald-300' : trackingState === 'reacquiring' ? 'text-amber-300' : 'text-rose-300'}`}>
        {trackingState === 'locked' ? '● LOCKED' : trackingState === 'reacquiring' ? '◐ REACQUIRING' : trackingState === 'lost' ? '○ TARGET LOST' : '○ NO LOCK'}
      </span>
      {candidates.map((c) => (
        <button
          key={c.id}
          onClick={() => {
            engineRefs.tracker.selectSubject(c.id, sessionClock.now());
            useSession.getState().set({ activeSubjectId: c.id });
          }}
          className={`rounded px-2 py-0.5 text-[11px] font-semibold ${c.id === activeSubjectId ? 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/50' : 'bg-white/5 text-slate-300 ring-1 ring-white/10 hover:bg-white/10'}`}
          aria-pressed={c.id === activeSubjectId}
        >
          Subject {c.id}
        </button>
      ))}
    </div>
  );
}
