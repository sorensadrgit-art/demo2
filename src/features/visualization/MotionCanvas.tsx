import { useEffect, useRef } from 'react';
import { frameStore } from './frameStore';
import { drawSkeleton } from './SkeletonRenderer';
import { drawAngleArc } from './AngleRenderer';
import { drawClinicalOverlay } from './ClinicalOverlay';
import { drawTrails, drawCOM, drawCenterline } from './TrajectoryRenderer';
import { drawVectors } from './VectorRenderer';
import { drawTrackingBanner } from './ConfidenceRenderer';
import { hitTestJoint, jointVertexIndex } from './jointMap';
import { useSession } from '../../stores/sessionStore';
import { useUI } from '../../stores/uiStore';
import { useFocus } from '../focus/focusStore';
import { engineRefs } from '../capture/useMotionEngine';
import { sessionClock } from '../../lib/timing/timeSync';
import { LM } from '../pose/poseTypes';

/** Primary clinical view: video beneath a precision biomechanical overlay. */
export default function MotionCanvas({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const render = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (canvas) {
        const parent = canvas.parentElement;
        const W = parent ? parent.clientWidth : 960;
        const H = parent ? parent.clientHeight : 600;
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#04070d';
          ctx.fillRect(0, 0, W, H);
          // Video beneath overlay.
          if (video && video.readyState >= 2 && !engineRefs.demoMode) {
            const vw = video.videoWidth; const vh = video.videoHeight;
            const scale = Math.max(W / vw, H / vh);
            const dw = vw * scale; const dh = vh * scale;
            ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
            ctx.fillStyle = 'rgba(3,6,12,0.25)';
            ctx.fillRect(0, 0, W, H);
          } else {
            // Lab-grade synthetic stage in demo mode.
            const g = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.5, Math.max(W, H) * 0.7);
            g.addColorStop(0, '#0b1524');
            g.addColorStop(1, '#04070d');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
            ctx.strokeStyle = 'rgba(120,150,180,0.12)';
            ctx.lineWidth = 1;
            for (let i = 1; i < 8; i++) {
              ctx.beginPath(); ctx.moveTo((W / 8) * i, 0); ctx.lineTo((W / 8) * i, H); ctx.stroke();
            }
            ctx.beginPath(); ctx.moveTo(0, H * 0.9); ctx.lineTo(W, H * 0.9); ctx.stroke();
          }

          const st = useUI.getState();
          const f = frameStore;
          // Zero-chrome clinical capture: in Focus experience the canvas shows
          // ONLY the locked patient + the active protocol joint. Candidate
          // boxes, identity labels, skeleton clouds, trails/COM/vectors and
          // the tracking banner stay in Lab (hidden capabilities, not removed).
          const focusMode = useFocus.getState().experience === 'focus'
            && useFocus.getState().protocolId !== null;
          // Selectable subject outlines for non-active candidates (Lab only).
          const activeId = useSession.getState().activeSubjectId;
          if (!focusMode) {
            for (const c of f.candidates) {
              if (c.id === activeId) continue;
              ctx.save();
              ctx.strokeStyle = 'rgba(148,178,205,0.5)';
              ctx.setLineDash([5, 5]);
              ctx.lineWidth = 1.2;
              ctx.strokeRect(c.bbox.x * W, c.bbox.y * H, c.bbox.w * W, c.bbox.h * H);
              ctx.setLineDash([]);
              ctx.font = '600 10px Inter, sans-serif';
              ctx.fillStyle = 'rgba(180,205,228,0.9)';
              ctx.fillText(`SUBJECT ${c.id} · CLICK TO LOCK`, c.bbox.x * W + 6, c.bbox.y * H + 16);
              ctx.restore();
            }
          }
          // Dev/E2E-only assertion surface: how many candidate boxes were drawn
          // this session (production ignores it; the acceptance test requires 0
          // in Focus capture). The counter initializes to 0 on the first
          // rendered frame so the spec can distinguish "zero boxes" from
          // "instrumentation missing".
          if (typeof window !== 'undefined' && (!import.meta.env.PROD || import.meta.env.VITE_E2E_MODE === 'true')) {
            const w = window as unknown as { __kinelabBoxesDrawn?: number };
            if (w.__kinelabBoxesDrawn === undefined) w.__kinelabBoxesDrawn = 0;
            if (!focusMode && f.candidates.length > 1) {
              w.__kinelabBoxesDrawn += (f.candidates.length - 1);
            }
          }
          if (f.landmarks) {
            if (focusMode) {
              // Active protocol joint only: anchors + rays + arc + live value.
              const live = useSession.getState();
              drawClinicalOverlay(ctx, W, H, {
                lms: f.landmarks,
                joint: f.activeJoint,
                angle: f.angles[f.activeJoint] ?? NaN,
                vel: live.liveVel,
                level: f.level,
                jointValid: f.valid[f.activeJoint] ?? false,
                t: performance.now(),
              });
            } else {
              if (st.showGhost && f.ghost) drawSkeleton(ctx, f.ghost, W, H, { activeJoint: f.activeJoint, dimOthers: true, ghost: true });
              drawSkeleton(ctx, f.landmarks, W, H, { activeJoint: f.activeJoint, dimOthers: true });
              const ang = f.angles[f.activeJoint];
              if (typeof ang === 'number' && f.valid[f.activeJoint]) {
                drawAngleArc(ctx, f.landmarks, f.activeJoint, ang, W, H, performance.now());
              }
              if (st.showTrails) drawTrails(ctx, f.trails, W, H, jointVertexIndex(f.activeJoint));
              if (st.showCOM) drawCOM(ctx, f.com, W, H);
              const top = f.landmarks[LM.nose]; const hipL = f.landmarks[LM.leftHip]; const hipR = f.landmarks[LM.rightHip];
              if (top && hipL && hipR) {
                drawCenterline(ctx, top, { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 }, W, H);
              }
              if (st.showVectors) {
                const vels = (frameStore as { velocities?: Map<number, { x: number; y: number }> }).velocities;
                if (vels) drawVectors(ctx, f.landmarks, vels, W, H);
              }
            }
          }
          if (!focusMode) drawTrackingBanner(ctx, f.tracking, W, activeId);
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !frameStore.landmarks) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left; const py = e.clientY - rect.top;
    // Focus capture is zero-chrome: the protocol owns the joint and identity
    // is automatic — canvas tapping is Lab-only (manual recovery surface).
    const focusCapture = useFocus.getState().experience === 'focus'
      && useFocus.getState().protocolId !== null;
    if (focusCapture) return;
    // Subject selection first: clicking another outline re-locks.
    for (const c of frameStore.candidates) {
      const x = c.bbox.x * rect.width; const y = c.bbox.y * rect.height;
      const w = c.bbox.w * rect.width; const h = c.bbox.h * rect.height;
      if (px >= x && px <= x + w && py >= y && py <= y + h) {
        const isActive = c.id === useSession.getState().activeSubjectId;
        if (!isActive) {
          engineRefs.tracker.selectSubject(c.id, sessionClock.now());
          useSession.getState().set({ activeSubjectId: c.id });
          return;
        }
        break;
      }
    }
    const hit = hitTestJoint(px, py, frameStore.landmarks, rect.width, rect.height);
    if (hit) {
      useSession.getState().set({ activeJoint: hit });
      frameStore.activeJoint = hit;
    }
  };

  return <canvas ref={canvasRef} onClick={onClick} className="absolute inset-0 h-full w-full cursor-crosshair" aria-label="Live motion analysis view. Click a joint to measure it." />;
}
