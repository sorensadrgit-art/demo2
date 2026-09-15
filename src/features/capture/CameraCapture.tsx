import { useEffect, useRef, useState } from 'react';
import MotionCanvas from '../visualization/MotionCanvas';
import { useMotionEngine, engineRefs } from './useMotionEngine';
import { useSession } from '../../stores/sessionStore';
import { classifyCameraLabel, pickRgbCamera } from '../solo/provenance';

export default function CameraCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [camError, setCamError] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const sourceMode = useSession((s) => s.sourceMode);
  const set = useSession((s) => s.set);

  useMotionEngine(videoRef);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const start = async () => {
      if (sourceMode !== 'webcam') return;
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devs.filter((d) => d.kind === 'videoinput');
        if (cancelled) return;
        setDevices(videoInputs);
        // Prefer RGB Integrated Webcam; never auto-select IR/virtual as a
        // second viewpoint — single RGB camera only.
        const autoId = deviceId || pickRgbCamera(
          videoInputs.map((d) => ({ deviceId: d.deviceId, label: d.label || '' })),
        );
        const effectiveId = deviceId || autoId;
        if (!deviceId && autoId) setDeviceId(autoId);
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: effectiveId ? { exact: effectiveId } : undefined,
            width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          engineRefs.video = videoRef.current;
          await videoRef.current.play().catch(() => undefined);
        }
        // Record cameraMeta from the live track settings (single RGB source).
        const track = stream.getVideoTracks()[0];
        if (track) {
          const settings = track.getSettings();
          set({
            cameraMeta: {
              id: settings.deviceId ?? track.id ?? effectiveId,
              label: track.label || '',
              width: settings.width ?? videoRef.current?.videoWidth ?? 0,
              height: settings.height ?? videoRef.current?.videoHeight ?? 0,
              fps: settings.frameRate ?? 30,
            },
          });
        }
        setCamError(null);
        setNeedsPermission(false);
        engineRefs.demoMode = false;
      } catch (e) {
        const name = e instanceof DOMException ? e.name : e instanceof Error ? e.name : '';
        const msg = e instanceof Error ? e.message : String(e);
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setNeedsPermission(true);
          setCamError(
            'CAMERA PERMISSION DENIED — allow camera access in the browser site settings, then press Retry. Running synthetic subject mode meanwhile.',
          );
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setCamError(`NO RGB CAMERA FOUND (${msg || name}) — RUNNING SYNTHETIC SUBJECT MODE`);
        } else {
          setCamError(`CAMERA UNAVAILABLE (${msg || 'unknown error'}) — RUNNING SYNTHETIC SUBJECT MODE`);
        }
        engineRefs.demoMode = true;
      }
    };
    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      if (engineRefs.video === videoRef.current) engineRefs.video = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode, deviceId, retryTick]);

  const retry = () => {
    setCamError(null);
    setNeedsPermission(false);
    engineRefs.demoMode = false;
    setRetryTick((t) => t + 1);
  };

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
        {camError ? (
          <div className="pointer-events-auto max-w-xs rounded border border-red-400/40 bg-black/80 px-2 py-1.5 text-[11px] text-red-200" role="alert">
            <p>{camError}</p>
            {needsPermission ? (
              <button
                onClick={retry}
                className="mt-1 rounded bg-red-500/20 px-2 py-1 text-[10px] font-bold tracking-widest text-red-100 ring-1 ring-red-400/50 hover:bg-red-500/30"
              >
                RETRY CAMERA
              </button>
            ) : null}
          </div>
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
            {devices.map((d, i) => {
              const kind = classifyCameraLabel(d.label || '');
              const tag = kind === 'ir' ? 'IR — not a viewpoint' : kind === 'virtual' ? 'VIRTUAL — not a viewpoint' : kind === 'rgb' ? 'RGB' : 'UNKNOWN';
              return (
                <option key={d.deviceId || i} value={d.deviceId}>
                  Cam {i + 1} · {d.label || 'camera'} [{tag}]
                </option>
              );
            })}
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
