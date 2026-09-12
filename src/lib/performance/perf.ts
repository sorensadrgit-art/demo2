// Lock-free ring instrumentation for inference/render performance.
export interface PerfSnapshot {
  inferenceFps: number;
  renderFps: number;
  droppedFrames: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
}

export class PerfMonitor {
  private inferTimes: number[] = [];
  private renderTimes: number[] = [];
  private latencies: number[] = [];
  droppedFrames = 0;
  lastLatencyMs = 0;

  markInference(t = performance.now()) {
    this.inferTimes.push(t);
    if (this.inferTimes.length > 120) this.inferTimes.shift();
  }
  markRender(t = performance.now()) {
    this.renderTimes.push(t);
    if (this.renderTimes.length > 240) this.renderTimes.shift();
  }
  markLatency(ms: number) {
    this.lastLatencyMs = ms;
    this.latencies.push(ms);
    if (this.latencies.length > 120) this.latencies.shift();
  }
  markDropped(n = 1) { this.droppedFrames += n; }

  private fps(times: number[]): number {
    if (times.length < 2) return 0;
    const span = (times[times.length - 1] - times[0]) / 1000;
    return span > 0 ? (times.length - 1) / span : 0;
  }

  snapshot(): PerfSnapshot {
    const avg = this.latencies.length
      ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length : 0;
    return {
      inferenceFps: Math.round(this.fps(this.inferTimes) * 10) / 10,
      renderFps: Math.round(this.fps(this.renderTimes) * 10) / 10,
      droppedFrames: this.droppedFrames,
      lastLatencyMs: Math.round(this.lastLatencyMs * 10) / 10,
      avgLatencyMs: Math.round(avg * 10) / 10,
    };
  }
}

export const perfMonitor = new PerfMonitor();
