// Monotonic session timeline. Every stream (video, pose, IMU, force,
// dynamometer, EMG) maps its native timestamps onto this single clock.
export class SessionClock {
  private t0performance = -1;
  private t0wall = 0;
  private offsetMs = 0;

  start(nowPerformance = performance.now(), nowWall = Date.now()) {
    this.t0performance = nowPerformance;
    this.t0wall = nowWall;
    this.offsetMs = 0;
  }

  now(nowPerformance = performance.now()): number {
    if (this.t0performance < 0) this.start(nowPerformance);
    return nowPerformance - this.t0performance + this.offsetMs;
  }

  wallToSession(wallMs: number): number { return wallMs - this.t0wall + this.offsetMs; }
  sessionToWall(sessionMs: number): number { return sessionMs + this.t0wall - this.offsetMs; }
  correctOffset(deltaMs: number) { this.offsetMs += deltaMs; }
  get started(): boolean { return this.t0performance >= 0; }
}

export const sessionClock = new SessionClock();

/** Map an external device timestamp (device-local ms) to session time. */
export class DeviceTimeMapper {
  private pairs: Array<{ device: number; session: number }> = [];
  constructor(private maxPairs = 32) {}

  observe(deviceMs: number, sessionMs: number) {
    this.pairs.push({ device: deviceMs, session: sessionMs });
    if (this.pairs.length > this.maxPairs) this.pairs.shift();
  }

  toSession(deviceMs: number): number {
    if (!this.pairs.length) return deviceMs;
    const offs = this.pairs.map((p) => p.device - p.session).sort((a, b) => a - b);
    return deviceMs - offs[Math.floor(offs.length / 2)];
  }
}
