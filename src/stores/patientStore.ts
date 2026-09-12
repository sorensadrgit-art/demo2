import { create } from 'zustand';

export interface VisitRecord {
  id: string;
  date: string;
  movementId: string;
  jointLabel: string;
  peak: number;
  excursion: number;
  peakVelocity: number;
  reps: number;
  notes?: string;
}

export interface Patient {
  id: string;
  name: string;
  dob?: string;
  affectedSide: 'left' | 'right' | 'bilateral' | 'na';
  heightCm?: number;
  massKg?: number;
  visits: VisitRecord[];
}

interface PatientState {
  patients: Patient[];
  activePatientId: string;
 Ghost?: VisitRecord | null;
  activePatient: () => Patient;
  addVisit: (v: VisitRecord) => void;
  selectPatient: (id: string) => void;
  baseline: () => VisitRecord | null;
}

const seed: Patient[] = [
  {
    id: 'PT-001', name: 'A. Rivera', affectedSide: 'left', heightCm: 172, massKg: 74,
    visits: [
      { id: 'v1', date: 'Visit 1 · Aug 02', movementId: 'squat', jointLabel: 'Knee flexion ROM', peak: 96, excursion: 84, peakVelocity: 61, reps: 5 },
      { id: 'v2', date: 'Visit 2 · Aug 16', movementId: 'squat', jointLabel: 'Knee flexion ROM', peak: 108, excursion: 96, peakVelocity: 72, reps: 6 },
      { id: 'v3', date: 'Visit 3 · Aug 30', movementId: 'squat', jointLabel: 'Knee flexion ROM', peak: 117, excursion: 108, peakVelocity: 79, reps: 6 },
    ],
  },
  {
    id: 'PT-002', name: 'J. Okafor', affectedSide: 'right', heightCm: 181, massKg: 86,
    visits: [
      { id: 'v1', date: 'Visit 1 · Aug 09', movementId: 'shoulder-flexion', jointLabel: 'Shoulder flexion ROM', peak: 121, excursion: 118, peakVelocity: 55, reps: 4 },
    ],
  },
];

export const usePatients = create<PatientState>((set, get) => ({
  patients: seed,
  activePatientId: 'PT-001',
  activePatient: () => get().patients.find((p) => p.id === get().activePatientId) ?? get().patients[0],
  addVisit: (v) => set((st) => ({
    patients: st.patients.map((p) => p.id === st.activePatientId ? { ...p, visits: [...p.visits, v] } : p),
  })),
  selectPatient: (id) => set({ activePatientId: id }),
  baseline: () => {
    const p = get().patients.find((x) => x.id === get().activePatientId);
    return p && p.visits.length ? p.visits[0] : null;
  },
}));
