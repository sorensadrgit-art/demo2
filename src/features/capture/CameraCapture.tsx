import { useEffect, useRef, useState } from 'react';
import MotionCanvas from '../visualization/MotionCanvas';
import { useMotionEngine, engineRefs } from './useMotionEngine';
import { useSession } from '../../stores/sessionStore';

export default function CameraCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [camError, setCamError] = useState<string | null>(null);
  const sourceMode = useSession((s) => s.sourceMode);
  const set = useSession((s) => s.set);

  useMotionEngine(videoRef);

  useEffect(() => {
    let stream: MediaStream | null = null;
    const start = async () => {
      if (sourceMode !== 'webcam') return;
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        setDevices(devs.filter((d) => d.kind === 'videoinput'));
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
          },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          engineRefs.video = videoRef.current;
          await videoRef.current.play().catch(() => undefined);
        }
        setCamError(null);
      } catch {
        setCamError('CAMERA UNAVAILABLE — RUNNING SYNTHETIC SUBJECT MODE');
        engineRefs.demoMode = true;
      }
    };
    void start();
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode, deviceId]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#04070d]">
      <video ref={videoRef} playsInline muted className="hidden" aria-hidden />
      <MotionCanvas videoRef={videoRef} />
      <div className="pointer-events-none absolute left-3 top-12 flex flex-col gap-1.5">
        {engineRefs.e2eSource ? (
          <span className="rounded border border-violet-400/50 bg-black/70 px-2 py-1 text-[10px] font-semibold tracking-widest text-violet-300">
            E2E TEST INPUT · NOT A PATIENT MEASUREMENT
          </span>
        ) : null}
        {engineRefs.demoMode || camError ? (
          <span className="rounded border border-amber-400/40 bg-black/70 px-2 py-1 text-[10px] font-semibold tracking-widest text-amber-300">
            SYNTHETIC SUBJECT · NO CAMERA SIGNAL
          </span>
        ) : null}
        <label className="pointer-events-auto flex items-center gap-2 rounded border border-white/10 bg-black/70 px-2 py-1 text-[10px] text-slate-300">
          DEVICE
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="bg-transparent text-[10px] text-slate-200 outline-none"
            aria-label="Camera device"
          >
            <option value="">Default camera</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>Cam {i + 1} · {d.label || 'camera'}</option>
            ))}
          </select>
        </label>
        <div className="pointer-events-auto flex gap-1" role="tablist" aria-label="Source mode">
          {(['webcam', 'upload', 'multicam', 'demo'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={sourceMode === m}
              onClick={() => { set({ sourceMode: m }); if (m === 'demo') engineRefs.demoMode = true; if (m === 'webcam') engineRefs.demoMode = false; }}
              className={`rounded px-2 py-1 text-[10px] font-semibold tracking-wider ${sourceMode === m ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/50' : 'bg-black/60 text-slate-400 ring-1 ring-white/10'}`}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
