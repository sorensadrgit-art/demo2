import type { LandmarkPoint3D } from '../measurement/domain';

/**
 * Segment coordinate systems V1 (Phase 19). Anatomical segment frames
 * built ONLY from landmarks the schema defensibly supports — no invented
 * axes. Each segment exposes origin + orthonormal (x: lateral, y: proximal
 * / superior, z: anterior) basis in world meters.
 */
export type SegmentId =
  | 'pelvis' | 'femur-l' | 'femur-r' | 'shank-l' | 'shank-r'
  | 'foot-l' | 'foot-r' | 'thorax' | 'humerus-l' | 'humerus-r'
  | 'forearm-l' | 'forearm-r';

export interface SegmentFrame {
  segment: SegmentId;
  originM: { x: number; y: number; z: number };
  xAxis: { x: number; y: number; z: number };
  yAxis: { x: number; y: number; z: number };
  zAxis: { x: number; y: number; z: number };
  /** False when supporting landmarks were missing — frame is NaN. */
  valid: boolean;
}

type V = { x: number; y: number; z: number };
const v = (p: LandmarkPoint3D): V => ({ x: p.xM, y: p.yM, z: p.zM });
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V, b: V): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V, b: V): V => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
const mag = (a: V): number => Math.hypot(a.x, a.y, a.z);
const norm = (a: V): V => {
  const m = mag(a);
  return m < 1e-9 ? { x: NaN, y: NaN, z: NaN } : { x: a.x / m, y: a.y / m, z: a.z / m };
};
const mid = (a: V, b: V): V => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

const invalid = (segment: SegmentId): SegmentFrame => ({
  segment,
  originM: { x: NaN, y: NaN, z: NaN },
  xAxis: { x: NaN, y: NaN, z: NaN },
  yAxis: { x: NaN, y: NaN, z: NaN },
  zAxis: { x: NaN, y: NaN, z: NaN },
  valid: false,
});

export type LandmarkLookup = (id: string) => LandmarkPoint3D | null;

/**
 * Long-bone segment frame: y = proximal direction (distal→proximal),
 * x = lateral via world-X orthogonalized, z = x×y. Requires the two
 * endpoint landmarks only — the minimal defensible frame.
 */
function longBoneFrame(segment: SegmentId, proximal: LandmarkPoint3D | null, distal: LandmarkPoint3D | null): SegmentFrame {
  if (!proximal || !distal) return invalid(segment);
  const y = norm(sub(v(proximal), v(distal)));
  if (!Number.isFinite(y.x + y.y + y.z)) return invalid(segment);
  const worldX: V = { x: 1, y: 0, z: 0 };
  let x = norm(sub(worldX, { x: dot(worldX, y) * y.x, y: dot(worldX, y) * y.y, z: dot(worldX, y) * y.z }));
  if (!Number.isFinite(x.x + x.y + x.z)) {
    const worldZ: V = { x: 0, y: 0, z: 1 };
    x = norm(sub(worldZ, { x: dot(worldZ, y) * y.x, y: dot(worldZ, y) * y.y, z: dot(worldZ, y) * y.z }));
  }
  const z = norm(cross(x, y));
  return { segment, originM: mid(v(proximal), v(distal)), xAxis: x, yAxis: y, zAxis: z, valid: true };
}

/** Pelvis frame from bilateral hips: x = right→left hip axis. */
function pelvisFrame(lHip: LandmarkPoint3D | null, rHip: LandmarkPoint3D | null): SegmentFrame {
  if (!lHip || !rHip) return invalid('pelvis');
  const x = norm(sub(v(lHip), v(rHip)));
  if (!Number.isFinite(x.x + x.y + x.z)) return invalid('pelvis');
  const worldY: V = { x: 0, y: 1, z: 0 };
  const z = norm(cross(x, worldY));
  const y = norm(cross(z, x));
  return { segment: 'pelvis', originM: mid(v(lHip), v(rHip)), xAxis: x, yAxis: y, zAxis: z, valid: true };
}

/** Thorax frame from bilateral shoulders + mid-hips reference. */
function thoraxFrame(
  lSh: LandmarkPoint3D | null, rSh: LandmarkPoint3D | null,
  lHip: LandmarkPoint3D | null, rHip: LandmarkPoint3D | null,
): SegmentFrame {
  if (!lSh || !rSh || !lHip || !rHip) return invalid('thorax');
  const x = norm(sub(v(lSh), v(rSh)));
  const y = norm(sub(mid(v(lSh), v(rSh)), mid(v(lHip), v(rHip))));
  if (!Number.isFinite(x.x + x.y + x.z + y.x + y.y + y.z)) return invalid('thorax');
  const z = norm(cross(x, y));
  const yO = norm(cross(z, x));
  return { segment: 'thorax', originM: mid(v(lSh), v(rSh)), xAxis: x, yAxis: yO, zAxis: z, valid: true };
}

/** Build all V1 segment frames from a landmark lookup. */
export function buildSegmentFrames(get: LandmarkLookup): Record<SegmentId, SegmentFrame> {
  const lHip = get('left-hip'); const rHip = get('right-hip');
  const lKnee = get('left-knee'); const rKnee = get('right-knee');
  const lAnkle = get('left-ankle'); const rAnkle = get('right-ankle');
  const lSh = get('left-shoulder'); const rSh = get('right-shoulder');
  const lElb = get('left-elbow'); const rElb = get('right-elbow');
  const lWr = get('left-wrist'); const rWr = get('right-wrist');
  const lHeel = get('left-heel'); const rHeel = get('right-heel');
  return {
    pelvis: pelvisFrame(lHip, rHip),
    'femur-l': longBoneFrame('femur-l', lHip, lKnee),
    'femur-r': longBoneFrame('femur-r', rHip, rKnee),
    'shank-l': longBoneFrame('shank-l', lKnee, lAnkle),
    'shank-r': longBoneFrame('shank-r', rKnee, rAnkle),
    'foot-l': longBoneFrame('foot-l', lAnkle, lHeel),
    'foot-r': longBoneFrame('foot-r', rAnkle, rHeel),
    thorax: thoraxFrame(lSh, rSh, lHip, rHip),
    'humerus-l': longBoneFrame('humerus-l', lSh, lElb),
    'humerus-r': longBoneFrame('humerus-r', rSh, rElb),
    'forearm-l': longBoneFrame('forearm-l', lElb, lWr),
    'forearm-r': longBoneFrame('forearm-r', rElb, rWr),
  };
}
