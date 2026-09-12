import { useSession } from '../../stores/sessionStore';
import { CONFIDENCE_STYLE } from '../biomechanics/confidence';

export default function TrackingStatus() {
  const trackingState = useSession((s) => s.trackingState);
  const liveLevel = useSession((s) => s.liveLevel);
  const liveReasons = useSession((s) => s.liveReasons);
  const conf = CONFIDENCE_STYLE[liveLevel];

  return (
    <div className="flex flex-wrap items-center gap-2" role="status" aria-label={`Tracking ${trackingState}, ${conf.label}`}>
      <span className="rounded border border-white/10 bg-black/60 px-2 py-1 text-[10px] font-bold tracking-widest text-slate-200">
        {trackingState.toUpperCase()}
      </span>
      <span
        className="rounded border px-2 py-1 text-[10px] font-bold tracking-widest"
        style={{ color: conf.color, borderColor: `${conf.color}55`, background: 'rgba(0,0,0,0.6)' }}
      >
        {conf.label.toUpperCase()}
      </span>
      {liveReasons.slice(0, 3).map((r) => (
        <span key={r} className="rounded bg-rose-500/10 px-2 py-1 text-[10px] font-semibold tracking-wider text-rose-300 ring-1 ring-rose-400/30">
          {r}
        </span>
      ))}
    </div>
  );
}
