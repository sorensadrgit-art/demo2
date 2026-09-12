import type { SensorSample, SensorType } from './kineticsTypes';
import { DeviceTimeMapper } from '../../lib/timing/timeSync';

// Hardware-adapter interface for future physical sensors.
export interface IExternalSensorProvider {
  readonly deviceId: string;
  readonly sensorType: SensorType;
  readonly sampleRate: number;
  readonly unit: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onSample(cb: (s: SensorSample) => void): () => void;
  readonly connected: boolean;
}

/** In-memory bus: providers publish, timeline/metrics subscribe. */
export class SensorBus {
  private listeners = new Set<(s: SensorSample) => void>();
  private mappers = new Map<string, DeviceTimeMapper>();
  samples: SensorSample[] = [];

  subscribe(cb: (s: SensorSample) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  publish(raw: Omit<SensorSample, 't'> & { deviceTimeMs: number; sessionNow: number }) {
    let mapper = this.mappers.get(raw.deviceId);
    if (!mapper) { mapper = new DeviceTimeMapper(); this.mappers.set(raw.deviceId, mapper); }
    mapper.observe(raw.deviceTimeMs, raw.sessionNow);
    const sample: SensorSample = {
      t: mapper.toSession(raw.deviceTimeMs),
      deviceId: raw.deviceId, sensorType: raw.sensorType,
      value: raw.value, unit: raw.unit,
      confidence: raw.confidence, sampleRate: raw.sampleRate,
    };
    this.samples.push(sample);
    for (const cb of this.listeners) cb(sample);
  }

  clear() { this.samples = []; }
}

export const sensorBus = new SensorBus();

/** Simulated provider for development/testing — clearly labeled, never clinical. */
export class SimulatedSensorProvider implements IExternalSensorProvider {
  connected = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cbs = new Set<(s: SensorSample) => void>();
  constructor(
    readonly deviceId: string,
    readonly sensorType: SensorType = 'forcePlate',
    readonly sampleRate = 100,
    readonly unit = 'N',
  ) {}
  async connect(): Promise<void> {
    this.connected = true;
    const period = 1000 / this.sampleRate;
    let i = 0;
    this.timer = setInterval(() => {
      const s: SensorSample = {
        t: performance.now(), deviceId: this.deviceId, sensorType: this.sensorType,
        value: 650 + 120 * Math.sin(i++ * 0.05) + (Math.random() - 0.5) * 8,
        unit: this.unit, confidence: 0.99, sampleRate: this.sampleRate,
      };
      for (const cb of this.cbs) cb(s);
    }, period);
  }
  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  onSample(cb: (s: SensorSample) => void): () => void {
    this.cbs.add(cb);
    return () => { this.cbs.delete(cb); };
  }
}
