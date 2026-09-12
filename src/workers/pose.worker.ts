// Pose inference worker: keeps heavy MediaPipe inference off the main
// thread and outside React's render loop. Main thread posts ImageBitmaps;
// worker responds with transferable landmark payloads.
import { MediaPipePoseProvider } from '../features/pose/MediaPipePoseProvider';

let provider: MediaPipePoseProvider | null = null;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as
    | { type: 'init'; opts?: Record<string, unknown> }
    | { type: 'frame'; bitmap: ImageBitmap; timestamp: number; id: number }
    | { type: 'close' };
  try {
    if (msg.type === 'init') {
      provider = new MediaPipePoseProvider();
      await provider.initialize(msg.opts ?? { numPoses: 3 });
      self.postMessage({ type: 'ready' });
    } else if (msg.type === 'frame') {
      if (!provider) {
        self.postMessage({ type: 'error', id: msg.id, error: 'not-initialized' });
        return;
      }
      const off = new OffscreenCanvas(msg.bitmap.width, msg.bitmap.height);
      const ctx = off.getContext('2d');
      ctx?.drawImage(msg.bitmap, 0, 0);
      msg.bitmap.close();
      const frame = await (provider as unknown as {
        detectFromCanvas: (c: OffscreenCanvas, t: number) => Promise<unknown>;
      }).detectFromCanvas?.(off, msg.timestamp);
      self.postMessage({ type: 'result', id: msg.id, frame: frame ?? null });
    } else if (msg.type === 'close') {
      await provider?.close();
      provider = null;
      self.postMessage({ type: 'closed' });
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
