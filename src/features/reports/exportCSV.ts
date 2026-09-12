import type { MetricSample } from '../../stores/sessionStore';
import type { JointId } from '../biomechanics/jointAngles';

export function timelineToCSV(samples: MetricSample[], joints: JointId[]): string {
  const header = ['t_ms', ...joints.flatMap((j) => [`${j}_deg`, `${j}_valid`])].join(',');
  const rows = samples.map((s) => [
    s.t.toFixed(1),
    ...joints.flatMap((j) => {
      const v = s.angles[j];
      return [Number.isFinite(v) ? (v as number).toFixed(2) : '', s.valid[j] ? '1' : '0'];
    }),
  ].join(','));
  return [header, ...rows].join('\n');
}

export function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function sessionToJSON(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, null, 2);
}
