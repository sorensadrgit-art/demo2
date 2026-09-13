import { describe, it, expect } from 'vitest';
import { createSessionRecord, migrateSessionRecord, emptyLayers, SESSION_SCHEMA_VERSION } from '../../src/measurement/storage';
import { makeMeasurement, gradeSupportsConfidence, PROCESSING_PIPELINE_VERSION } from '../../src/measurement/domain';
import { PointTemporalFilter, TemporalFilterBank } from '../../src/reconstruction/filtering';
import { buildSegmentFrames } from '../../src/biomechanics3d/segments';
import { KineLabSegmentModel } from '../../src/biomechanics3d/modelAdapter';
import { OpenSimAdapter, opensimIntegrationStatus, toOpenSimJointName } from '../../src/biomechanics3d/opensim';
import { ensureDefaultProviders, listPoseProviders, rtmwIntegrationStatus } from '../../src/measurement/providers';
import { getSchema, anatomicalToMediapipe33, mediapipe33ToAnatomical } from '../../src/measurement/schemas';

/** Domain, storage, schemas, filtering, segments, adapters. */
describe('measurement domain + storage + adapters', () => {
  it('measurements carry grade/source/provenance; grade gates confidence', () => {
    const m = makeMeasurement({
      metric: 'joint-angle', value: 118.4, unit: 'deg',
      acquisitionGrade: 'clinical', source: 'triangulated-3d',
      confidence: { level: 'moderate', score: 0.7, reasons: ['ENGINEERING QA'] },
      provenance: { providerName: 'MediaPipePoseProvider', protocolId: 'knee-flexion-arom', cameraIds: ['c1', 'c2'] },
      timestamp: { monotonicMs: 100, frameIndex: 6 },
    });
    expect(m.id.length).toBeGreaterThan(0);
    expect(m.provenance.processingPipelineVersion).toBe(PROCESSING_PIPELINE_VERSION);
    expect(gradeSupportsConfidence('precision', 'high', 2)).toBe(false);
    expect(gradeSupportsConfidence('precision', 'high', 4)).toBe(true);
    expect(gradeSupportsConfidence('clinical', 'moderate', 2)).toBe(true);
    expect(gradeSupportsConfidence('solo', 'suspended', 0)).toBe(true);
  });

  it('session records are versioned; raw never overwritten by derived', () => {
    const s = createSessionRecord({
      sessionId: 's1', patientId: 'p1', protocolId: 'knee-flexion-arom',
      acquisitionGrade: 'clinical', rigId: 'rig-clinic', cameraIds: ['c1', 'c2'],
      poseProvider: 'MediaPipePoseProvider', poseProviderVersion: '0.10.20',
      landmarkSchema: 'mediapipe-33', landmarkSchemaVersion: '1.0',
      pipelineVersion: PROCESSING_PIPELINE_VERSION,
    });
    expect(s.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
    expect(s.layers.raw).toBeDefined();
    expect(s.layers.derived.measurements).toHaveLength(0);
    const migrated = migrateSessionRecord({ sessionId: 'old' });
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.layers).toBeDefined();
    expect(emptyLayers().raw.frameSets).toHaveLength(0);
  });

  it('temporal filter keeps raw separate; null resets across tracking loss', () => {
    const f = new PointTemporalFilter();
    const raw = {
      landmarkId: 'left-knee', xM: 0.06, yM: 0.55, zM: 0,
      sourceCameraIds: ['c1', 'c2'], validViewCount: 2,
      observationConfidence: 0.9, reprojectionErrorPx: 1,
      timestamp: { monotonicMs: 0, frameIndex: 0 },
    };
    const r1 = f.update(raw)!;
    expect(r1.filtered.xM).toBeCloseTo(0.06, 9);
    expect(r1.raw).toBe(raw);
    expect(Number.isFinite(r1.residualM)).toBe(true);
    expect(f.update(null)).toBeNull();
    const r2 = f.update({ ...raw, timestamp: { monotonicMs: 5000, frameIndex: 300 } })!;
    expect(r2.filtered.xM).toBeCloseTo(0.06, 9);
    const bank = new TemporalFilterBank();
    expect(bank.update(raw, 'left-knee')).not.toBeNull();
  });

  it('segment frames build from schema landmarks; missing data invalid', () => {
    const frames = buildSegmentFrames(() => null);
    expect(frames['femur-l'].valid).toBe(false);
    expect(Number.isNaN(frames.pelvis.originM.x)).toBe(true);
    const mk = (x: number, y: number, z: number) => ({
      landmarkId: 'x', xM: x, yM: y, zM: z, sourceCameraIds: ['c1'],
      validViewCount: 1, observationConfidence: 1, reprojectionErrorPx: 0,
      timestamp: { monotonicMs: 0, frameIndex: 0 },
    });
    const good = buildSegmentFrames((id: string) => {
      const table: Record<string, { x: number; y: number; z: number }> = {
        'left-hip': { x: 0.06, y: 1, z: 0 }, 'right-hip': { x: -0.06, y: 1, z: 0 },
        'left-knee': { x: 0.06, y: 0.55, z: 0 }, 'left-ankle': { x: 0.06, y: 0.1, z: 0 },
      };
      const p = table[id];
      return p ? { ...mk(p.x, p.y, p.z), landmarkId: id } : null;
    });
    expect(good['femur-l'].valid).toBe(true);
    expect(good.pelvis.valid).toBe(true);
  });

  it('segment model solves kinematics; OpenSim/RTMW report BLOCKED honestly', async () => {
    const model = new KineLabSegmentModel();
    const pm = await model.initializePatientModel({ patientId: 'p1' });
    expect(pm.modelId).toMatch(/kinelab-seg/);
    const mk = (landmarkId: string, x: number, y: number, z: number) => ({
      landmarkId, xM: x, yM: y, zM: z, sourceCameraIds: ['c1', 'c2'],
      validViewCount: 2, observationConfidence: 0.9, reprojectionErrorPx: 1,
      timestamp: { monotonicMs: 0, frameIndex: 0 },
    });
    const frame = await model.solveKinematics([
      mk('left-hip', 0.06, 1, 0), mk('left-knee', 0.06, 0.55, 0), mk('left-ankle', 0.06, 0.1, 0),
      mk('left-shoulder', 0.12, 1.45, 0),
    ], 100);
    expect(Math.abs(frame.jointAnglesDeg['knee-flexion-l'] - 180)).toBeLessThan(1);
    expect(opensimIntegrationStatus().installed).toBe(false);
    expect(opensimIntegrationStatus().reason).toMatch(/BLOCKED/);
    const adapter = new OpenSimAdapter();
    await expect(adapter.solveKinematics([], 0)).rejects.toThrow(/BLOCKED/);
    adapter.attachFixtureCore(model);
    const f2 = await adapter.solveKinematics([mk('left-hip', 0, 1, 0)], 0);
    expect(f2.segments.pelvis).toBeDefined();
    expect(toOpenSimJointName('knee-flexion-l')).toBe('knee_angle_l');
    expect(toOpenSimJointName('unknown')).toBeNull();
    ensureDefaultProviders();
    expect(listPoseProviders()).toContain('mediapipe');
    expect(listPoseProviders()).toContain('rtmw');
    expect(rtmwIntegrationStatus().installed).toBe(false);
    expect(getSchema('mediapipe-33')?.landmarks).toHaveLength(33);
    expect(anatomicalToMediapipe33('left-knee')).toBe(25);
    expect(mediapipe33ToAnatomical(25)).toBe('left-knee');
  });
});
