import type { PoseDetection } from '../pose/poseTypes';
import { PatientIdentityManager, type AcquisitionConfig } from './patientIdentity';
import type { TrackingState } from './patientIdentity';

export type { TrackingState };

export interface TrackedSubject {
  id: number;
  bbox: PoseDetection['bbox'];
  centroid: { x: number; y: number };
  velocity: { x: number; y: number };
  torsoHeight: number;
  shoulderWidth: number;
  lastSeen: number;
  confidence: number;
  predictedBbox: PoseDetection['bbox'] | null;
}

/**
 * Persistent subject lock - backed by PatientIdentityManager.
 *
 * API-compatible facade (Lab manual selection, existing tests):
 * activeSubjectId, selectSubject, clearSelection, matchThreshold,
 * reacquireWindowMs, continuity, update() returns state, active, activeId,
 * candidates. Acquisition is automatic (scored, stability-gated, sticky);
 * manual selectSubject remains as the emergency/debug path only.
 */
export class SubjectTracker extends PatientIdentityManager {
  /** Active track snapshot for Lab/debug surfaces (never rendered in Focus). */
  get activeTrack(): TrackedSubject | null {
    const id = this.activePatientId;
    if (id === null) return null;
    const t = this.debugTrack(id);
    if (!t) return null;
    return {
      id: t.id, bbox: t.bbox, centroid: t.centroid, velocity: t.velocity,
      torsoHeight: t.torsoHeight, shoulderWidth: t.shoulderWidth,
      lastSeen: t.lastSeen, confidence: t.confidence, predictedBbox: null,
    };
  }
}

export type { AcquisitionConfig };
