import type { AcquisitionGrade, ClinicalMeasurement, MeasurementMetric } from './domain';
import type { SynchronizedFrameSet, SynchronizationQuality } from '../reconstruction/sync';

/**
 * Versioned session storage schema (Phases 33-34). Raw → reconstructed →
 * derived → interpreted layers are stored separately and NEVER overwrite
 * each other. schemaVersion + pipelineVersion on every record.
 */
export const SESSION_SCHEMA_VERSION = 1;

export interface StoredSession {
  schemaVersion: number;
  pipelineVersion: string;
  sessionId: string;
  patientId: string;
  protocolId: string;
  acquisitionGrade: AcquisitionGrade;
  rigId: string;
  cameraIds: string[];
  calibrationId?: string;
  calibrationValid?: boolean;
  poseProvider: string;
  poseProviderVersion: string;
  landmarkSchema: string;
  landmarkSchemaVersion: string;
  createdAt: string;
  layers: SessionLayers;
}

export interface RawLayer {
  /** Camera metadata + frame references + 2D detections (URIs, not pixels). */
  cameras: Array<{ cameraId: string; width: number; height: number; fps: number }>;
  frameSets: SynchronizedFrameSet[];
  syncQuality: SynchronizationQuality[];
}

export interface ReconstructedLayer {
  landmarkIds: string[];
  /** Per-frame 3D points (null = insufficient observability, never gap-filled). */
  frames: Array<{ tMs: number; points: Record<string, { x: number; y: number; z: number; err: number; views: number } | null> }>;
}

export interface DerivedLayer {
  measurements: ClinicalMeasurement[];
}

export interface InterpretedLayer {
  events: Array<{ tMs: number; label: string; detail?: string }>;
  summary?: string;
}

export interface SessionLayers {
  raw: RawLayer;
  reconstructed: ReconstructedLayer;
  derived: DerivedLayer;
  interpreted: InterpretedLayer;
}

export function emptyLayers(): SessionLayers {
  return {
    raw: { cameras: [], frameSets: [], syncQuality: [] },
    reconstructed: { landmarkIds: [], frames: [] },
    derived: { measurements: [] },
    interpreted: { events: [] },
  };
}

export function createSessionRecord(init: {
  sessionId: string;
  patientId: string;
  protocolId: string;
  acquisitionGrade: AcquisitionGrade;
  rigId: string;
  cameraIds: string[];
  calibrationId?: string;
  poseProvider: string;
  poseProviderVersion: string;
  landmarkSchema: string;
  landmarkSchemaVersion: string;
  pipelineVersion: string;
}): StoredSession {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    pipelineVersion: init.pipelineVersion,
    sessionId: init.sessionId,
    patientId: init.patientId,
    protocolId: init.protocolId,
    acquisitionGrade: init.acquisitionGrade,
    rigId: init.rigId,
    cameraIds: init.cameraIds,
    calibrationId: init.calibrationId,
    poseProvider: init.poseProvider,
    poseProviderVersion: init.poseProviderVersion,
    landmarkSchema: init.landmarkSchema,
    landmarkSchemaVersion: init.landmarkSchemaVersion,
    createdAt: new Date().toISOString(),
    layers: emptyLayers(),
  };
}

/** Migration: v0 blobs (unversioned) → v1. Future migrations chain here. */
export function migrateSessionRecord(raw: unknown): StoredSession {
  const r = raw as Partial<StoredSession>;
  if ((r.schemaVersion ?? 0) >= 1) return r as StoredSession;
  return {
    schemaVersion: 1,
    pipelineVersion: (r.pipelineVersion as string) ?? 'unknown',
    sessionId: (r.sessionId as string) ?? `migrated-${Date.now()}`,
    patientId: (r.patientId as string) ?? 'unknown',
    protocolId: (r.protocolId as string) ?? 'unknown',
    acquisitionGrade: (r.acquisitionGrade as AcquisitionGrade) ?? 'solo',
    rigId: 'rig-unknown',
    cameraIds: (r.cameraIds as string[]) ?? [],
    poseProvider: 'unknown',
    poseProviderVersion: 'unknown',
    landmarkSchema: 'mediapipe-33',
    landmarkSchemaVersion: '1.0',
    createdAt: new Date().toISOString(),
    layers: (r.layers as SessionLayers) ?? emptyLayers(),
  };
}

export type { MeasurementMetric };
