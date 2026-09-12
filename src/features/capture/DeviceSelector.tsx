import { useEffect, useState } from 'react';
import { useSession } from '../../stores/sessionStore';

/** Multi-camera setup placeholder: enumerates devices, stages sync architecture. */
export default function DeviceSelector() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const set = useSession((s) => s.set);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices()
      .then((d) => setDevices(d.filter((x) => x.kind === 'videoinput')))
      .catch(() => setDevices([]));
  }, []);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-xs font-bold tracking-[0.18em] text-slate-300">MULTI-CAMERA SYNC</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        Synchronized capture triangulates 2D landmarks into 3D trajectories. Single-camera mode remains
        the validated path until calibration completes — no shared-accuracy claims.
      </p>
      <div className="mt-3 flex flex-col gap-1.5">
        {devices.length === 0 && (
          <span className="text-[11px] text-slate-500">No additional cameras detected.</span>
        )}
        {devices.map((d, i) => (
          <label key={d.deviceId || i} className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={selected.includes(d.deviceId)}
              onChange={(e) => setSelected((s) => e.target.checked ? [...s, d.deviceId] : s.filter((x) => x !== d.deviceId))}
              className="accent-sky-400"
            />
            Camera {i + 1} · {d.label || 'unnamed device'}
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => set({ sourceMode: 'multicam' })}
          className="rounded bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-200 ring-1 ring-sky-400/40"
        >
          STAGE {selected.length || 2}-CAM SESSION
        </button>
        <span className="self-center text-[11px] text-amber-300/90">Requires checkerboard calibration before triangulation.</span>
      </div>
    </div>
  );
}
