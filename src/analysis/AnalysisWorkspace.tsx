import { useMemo, useState } from 'react';
import BodyScene from '../features/three/BodyScene';
import Waveform from '../features/timeline/Waveform';
import { JOINT_DEFS, type JointId } from '../features/biomechanics/jointAngles';
import { useSession } from '../stores/sessionStore';
import type { AcquisitionGrade, ClinicalMeasurement } from '../measurement/domain';
import { formatAngle } from '../features/biomechanics/confidence';

/**
 * Clinical Analysis Workspace V1 (Phases 27-30, 25). Post-capture review:
 * primary view + camera strip (fixture data only, labeled) + synchronized
 * timeline + joint waveform + measurement-driven 3D + quality/provenance
 * inspector. Reuses BodyScene (3D) and Waveform (timeline) — no duplicate
 * renderers. No fake metrics: every panel states its source.
 */

export interface ReviewCamera {
  id: string;
  label: string;
  fixture: boolean;
}

interface AnalysisWorkspaceProps {
  cameras?: ReviewCamera[];
  grade?: AcquisitionGrade;
  providerName?: string;
  calibrationId?: string;
  measurements?: ClinicalMeasurement[];
}

const GRADE_LABEL: Record<AcquisitionGrade, string> = {
  precision: 'PRECISION · 6–8 CAM · ENGINEERING QA',
  clinical: 'CLINICAL · 2–3 CAM · ENGINEERING QA',
  solo: 'SOLO · SINGLE CAM · SCREENING GRADE',
};

export default function AnalysisWorkspace({
  cameras = [{ id: 'cam-solo-01', label: 'CAM 1 · SOLO', fixture: true }],
  grade = 'solo',
  providerName = 'MediaPipePoseProvider',
  calibrationId,
  measurements = [],
}: AnalysisWorkspaceProps) {
  const timeline = useSession((s) => s.timeline);
  const session = useSession((s) => s.session);
  const repCount = useSession((s) => s.repCount);
  const [joint, setJoint] = useState<JointId>('leftKnee');
  const [primaryCam, setPrimaryCam] = useState(cameras[0]?.id ?? 'cam-solo-01');
  const [scrubT, setScrubT] = useState<number | null>(null);

  const jointMeasurements = useMemo(
    () => measurements.filter((m) => m.metric === 'joint-angle'),
    [measurements],
  );
  const latest = jointMeasurements[jointMeasurements.length - 1] ?? null;
  const rom = useMemo(() => {
    const vals = timeline.map((s) => s.angles[joint]).filter((v): v is number => Number.isFinite(v));
    if (vals.length < 2) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [timeline, joint]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3" aria-label="Clinical analysis workspace">
      {/* Header: patient · protocol · trial · grade */}
      <header className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <span className="text-xs font-bold text-slate-200">{session.patientId || 'No patient'}</span>
        <span className="text-[11px] text-slate-500">{session.movementId || 'No protocol'}</span>
        <span className="rounded bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-300">
          REPS {repCount}
        </span>
        <span
          className="rounded px-2 py-0.5 text-[10px] font-bold tracking-widest ring-1"
          title="Acquisition grade: spatial certainty tier. Solo never implies multi-view certainty."
        >
          <span className={grade === 'solo' ? 'text-amber-200 ring-amber-400/40' : 'text-sky-200 ring-sky-400/40'}>
            {GRADE_LABEL[grade]}
          </span>
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-5">
        {/* Primary synchronized view */}
        <section className="rounded-xl border border-white/10 bg-black/40 p-2 lg:col-span-3" aria-label="Primary synchronized view">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-[10px] font-bold tracking-[0.2em] text-slate-400">
              PRIMARY · {cameras.find((c) => c.id === primaryCam)?.label ?? primaryCam}
            </h2>
            <span className="font-mono text-[10px] text-slate-500">SYNC {timeline.length} SMP</span>
          </div>
          <div className="min-h-[320px] rounded-lg bg-white/[0.02]">
            <BodyScene />
          </div>
          {/* Camera strip: fixture-labeled unless multi-camera data exists */}
          <div className="mt-2 flex gap-1 overflow-x-auto" role="group" aria-label="Camera strip">
            {cameras.map((c, i) => (
              <button
                key={c.id}
                onClick={() => setPrimaryCam(c.id)}
                aria-pressed={primaryCam === c.id}
                className={`shrink-0 rounded border px-2 py-1 text-left font-mono text-[10px] ${
                  primaryCam === c.id ? 'border-sky-400/60 bg-sky-500/15 text-sky-100' : 'border-white/10 bg-white/[0.03] text-slate-400'
                }`}
              >
                <span className="block font-bold">CAM {i + 1}</span>
                <span className="block text-[9px] opacity-70">{c.fixture ? 'FIXTURE' : c.id}</span>
              </button>
            ))}
          </div>
        </section>

        {/* 3D biomechanical representation + quality inspector */}
        <aside className="flex flex-col gap-2 lg:col-span-2" aria-label="Measurement inspector">
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3" aria-label="ROM and quality">
            <div className="mb-2 flex flex-wrap items-center gap-1">
              <label htmlFor="analysis-joint" className="text-[10px] font-bold tracking-widest text-slate-500">JOINT</label>
              <select
                id="analysis-joint"
                value={joint}
                onChange={(e) => setJoint(e.target.value as JointId)}
                className="rounded bg-black/50 px-2 py-1 text-xs text-slate-200 ring-1 ring-white/15"
              >
                {Object.values(JOINT_DEFS).map((j) => (
                  <option key={j.id} value={j.id}>{j.label}</option>
                ))}
              </select>
            </div>
            {rom ? (
              <p className="font-mono text-sm text-slate-100">
                ROM {formatAngle(rom.min, 'high')} → {formatAngle(rom.max, 'high')}
                <span className="text-slate-400"> · Δ {(rom.max - rom.min).toFixed(1)}°</span>
              </p>
            ) : (
              <p className="text-xs text-slate-500">No session samples yet — record a trial to populate the waveform.</p>
            )}
            {latest ? (
              <dl className="mt-2 grid grid-cols-2 gap-1 font-mono text-[11px]">
                <dt className="text-slate-500">Valid views</dt>
                <dd className="text-right text-slate-200">{latest.provenance.validViewCount ?? '—'}</dd>
                <dt className="text-slate-500">Reproj RMSE</dt>
                <dd className="text-right text-slate-200">
                  {latest.provenance.reprojectionErrorPx !== undefined ? `${latest.provenance.reprojectionErrorPx.toFixed(1)} px` : '—'}
                </dd>
                <dt className="text-slate-500">Acquisition</dt>
                <dd className="text-right text-slate-200">{latest.acquisitionGrade.toUpperCase()}</dd>
                <dt className="text-slate-500">Source</dt>
                <dd className="text-right text-slate-200">{latest.source}</dd>
                <dt className="text-slate-500">Confidence</dt>
                <dd className="text-right text-slate-200">{latest.confidence.level.toUpperCase()}</dd>
                <dt className="text-slate-500">Calibration</dt>
                <dd className="text-right text-slate-200">{latest.provenance.calibrationId ?? 'none'}</dd>
              </dl>
            ) : (
              <p className="mt-2 text-[11px] text-slate-500">
                No ClinicalMeasurement records yet. Provider {providerName}
                {calibrationId ? ` · calibration ${calibrationId}` : ' · uncalibrated optics'}.
                Solo values are screening-grade, not multi-view measurement.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3" aria-label="Provenance summary">
            <h3 className="text-[10px] font-bold tracking-[0.2em] text-slate-400">PROVENANCE · ENGINEERING QA</h3>
            <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-slate-500">
              <li>provider {providerName}</li>
              <li>schema mediapipe-33 v1.0</li>
              <li>pipeline kinelab-measurement-core/1.0</li>
              <li>calibration {calibrationId ?? 'none (setup QA only)'}</li>
              <li>validation pending — no clinical accuracy claimed</li>
            </ul>
          </section>
        </aside>
      </div>

      {/* Joint waveform + events + timeline */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-2" aria-label="Joint waveform and timeline">
        <Waveform samples={timeline} joint={joint} onScrub={setScrubT} scrubT={scrubT} height={110} />
      </section>
    </div>
  );
}
