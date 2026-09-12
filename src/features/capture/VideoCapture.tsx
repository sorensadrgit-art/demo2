import { useRef, useState } from 'react';
import MotionCanvas from '../visualization/MotionCanvas';
import { useMotionEngine, engineRefs } from './useMotionEngine';
import { MediaPipePoseProvider } from '../pose/MediaPipePoseProvider';
import { processDetections } from './useMotionEngine';
import { sessionClock } from '../../lib/timing/timeSync';
import { perfMonitor } from '../../lib/performance/perf';

/** Uploaded-recording analysis: file → frame-stepped inference → same pipeline. */
export default function VideoCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  useMotionEngine(videoRef);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (url) URL.revokeObjectURL(url);
    setUrl(URL.createObjectURL(f));
  };

  const analyze = async () => {
    const video = videoRef.current;
    if (!video) return;
    setAnalyzing(true);
    try {
      const provider = engineRefs.provider ?? new MediaPipePoseProvider();
      if (!engineRefs.provider) {
        await provider.initialize({ numPoses: 1 });
        engineRefs.provider = provider;
      }
      engineRefs.demoMode = false;
      engineRefs.video = video;
      video.currentTime = 0;
      await video.play().catch(() => undefined);
      const dur = video.duration || 10;
      const step = 1 / 30;
      let t = 0;
      while (t < dur && videoRef.current) {
        const now = sessionClock.now();
        const frame = await provider.detect(video, now);
        perfMonitor.markInference();
        processDetections(frame.detections, now);
        setProgress(Math.min(100, (t / dur) * 100));
        t += step;
        await new Promise((r) => setTimeout(r, 5));
      }
      video.pause();
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-[#04070d]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <label className="cursor-pointer rounded bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-200 ring-1 ring-sky-400/40 hover:bg-sky-500/30">
          UPLOAD RECORDING
          <input type="file" accept="video/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <button
          onClick={analyze}
          disabled={!url || analyzing}
          className="rounded bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-400/40 disabled:opacity-40"
        >
          {analyzing ? `ANALYZING ${progress.toFixed(0)}%` : 'RUN ANALYSIS'}
        </button>
        <span className="text-[11px] text-slate-500">RecordedAnalysisProvider path — same analytics, offline timestamps.</span>
      </div>
      <div className="relative flex-1">
        {url ? (
          <>
            <video ref={videoRef} src={url} controls playsInline className="absolute inset-0 h-full w-full object-contain opacity-90" />
            <div className="pointer-events-none absolute inset-0"><MotionCanvas videoRef={videoRef} /></div>
          </>
        ) : (
          <>
            <video ref={videoRef} playsInline muted className="hidden" />
            <MotionCanvas videoRef={videoRef} />
          </>
        )}
      </div>
    </div>
  );
}
