import { create } from 'zustand';

interface UIState {
  showTrails: boolean;
  showCOM: boolean;
  showVectors: boolean;
  showGhost: boolean;
  show3D: boolean;
  localOnly: boolean;
  reducedMotion: boolean;
  leftPanel: 'metrics' | 'calibration' | 'session';
  toggle: (k: 'showTrails' | 'showCOM' | 'showVectors' | 'showGhost' | 'show3D' | 'localOnly') => void;
  set: (p: Partial<UIState>) => void;
}

export const useUI = create<UIState>((set) => ({
  showTrails: true,
  showCOM: false,
  showVectors: true,
  showGhost: false,
  show3D: false,
  localOnly: true,
  reducedMotion: typeof window !== 'undefined'
    ? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    : false,
  leftPanel: 'metrics',
  toggle: (k) => set((st) => ({ [k]: !st[k] } as Partial<UIState>)),
  set: (p) => set(p),
}));
