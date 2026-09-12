// Reusable 2D/3D vector mathematics. All joint angles derive from these
// primitives — never from component-specific formulas.
export interface Vec3 { x: number; y: number; z: number; }
export interface Vec2 { x: number; y: number; }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });

export const sub3 = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const add3 = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const scale3 = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross3 = (a: Vec3, b: Vec3): Vec3 => v3(
  a.y * b.z - a.z * b.y,
  a.z * b.x - a.x * b.z,
  a.x * b.y - a.y * b.x,
);
export const mag3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const norm3 = (a: Vec3): Vec3 => {
  const m = mag3(a);
  return m < 1e-9 ? v3() : scale3(a, 1 / m);
};

export const sub2 = (a: Vec2, b: Vec2): Vec2 => v2(a.x - b.x, a.y - b.y);
export const dot2 = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const mag2 = (a: Vec2): number => Math.hypot(a.x, a.y);
export const norm2 = (a: Vec2): Vec2 => {
  const m = mag2(a);
  return m < 1e-9 ? v2() : v2(a.x / m, a.y / m);
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Unsigned angle between segments (degrees, 0-180). NaN when degenerate. */
export function angleBetween(a: Vec3, b: Vec3): number {
  if (mag3(a) < 1e-9 || mag3(b) < 1e-9) return NaN;
  const d = clamp(dot3(norm3(a), norm3(b)), -1, 1);
  return (Math.acos(d) * 180) / Math.PI;
}

/** Signed angle of b relative to a about a reference axis (degrees, -180-180). */
export function signedAngle(a: Vec3, b: Vec3, axis: Vec3): number {
  const na = norm3(a);
  const nb = norm3(b);
  const cross = cross3(na, nb);
  const s = dot3(cross, norm3(axis));
  const c = clamp(dot3(na, nb), -1, 1);
  return (Math.atan2(s, c) * 180) / Math.PI;
}

/** Project vector v onto the plane with unit normal n. */
export function projectToPlane(vec: Vec3, normal: Vec3): Vec3 {
  const n = norm3(normal);
  const d = dot3(vec, n);
  return sub3(vec, scale3(n, d));
}

/** Interior joint angle at vertex B formed by segments BA and BC. */
export function interiorAngle(a: Vec3, vertex: Vec3, c: Vec3): number {
  return angleBetween(sub3(a, vertex), sub3(c, vertex));
}

/** Normalize to [0, 360). */
export function normalizeAngle360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Shortest signed difference target - ref in (-180, 180]. */
export function angleDelta(target: number, ref: number): number {
  let d = (target - ref) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;
