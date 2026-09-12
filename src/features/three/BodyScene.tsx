import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { frameStore } from '../visualization/frameStore';
import { SKELETON_EDGES } from '../pose/poseTypes';

/** Optional 3D anatomical view: follows the tracked body; orbit/front/side/rear/top. */
export default function BodyScene() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<'orbit' | 'front' | 'side' | 'rear' | 'top'>('orbit');
  const [glError, setGlError] = useState<string | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || glError) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      setGlError(e instanceof Error ? e.message : 'WebGL unavailable');
      return;
    }
    const W = mount.clientWidth || 400;
    const H = mount.clientHeight || 320;
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.01, 50);
    const setCam = (v: string) => {
      if (v === 'front') camera.position.set(0, 0.1, 2.6);
      else if (v === 'side') camera.position.set(2.6, 0.1, 0);
      else if (v === 'rear') camera.position.set(0, 0.1, -2.6);
      else if (v === 'top') camera.position.set(0, 3, 0.4);
      else camera.position.set(1.6, 0.6, 2.2);
      camera.lookAt(0, -0.1, 0);
    };
    setCam(view);
    scene.add(new THREE.AmbientLight(0x8fb4d8, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 2);
    scene.add(key);

    const jointGeo = new THREE.SphereGeometry(0.022, 12, 12);
    const jointMat = new THREE.MeshStandardMaterial({ color: 0xdff1ff, roughness: 0.4 });
    const boneMat = new THREE.LineBasicMaterial({ color: 0x5aa9e6 });
    const joints: THREE.Mesh[] = [];
    const group = new THREE.Group();
    for (let i = 0; i < 33; i++) {
      const m = new THREE.Mesh(jointGeo, jointMat);
      group.add(m);
      joints.push(m);
    }
    const boneGeo = new THREE.BufferGeometry();
    const bonePos = new Float32Array(SKELETON_EDGES.length * 2 * 3);
    boneGeo.setAttribute('position', new THREE.BufferAttribute(bonePos, 3));
    group.add(new THREE.LineSegments(boneGeo, boneMat));
    // Floor grid for plane-of-motion intuition.
    const grid = new THREE.GridHelper(3, 12, 0x1e3a52, 0x10233a);
    grid.position.y = -1.05;
    scene.add(grid);
    scene.add(group);

    let raf = 0;
    let ang = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const lms = frameStore.landmarks;
      if (lms) {
        const pos = boneGeo.getAttribute('position') as THREE.BufferAttribute;
        lms.forEach((l, i) => {
          // Image space → scene: x centered, y up, z depth.
          joints[i].position.set((l.x - 0.5) * 2.2, -(l.y - 0.5) * 2.2, l.z * 1.4);
          joints[i].visible = l.visibility > 0.2;
        });
        SKELETON_EDGES.forEach(([a, b], e) => {
          pos.setXYZ(e * 2, joints[a].position.x, joints[a].position.y, joints[a].position.z);
          pos.setXYZ(e * 2 + 1, joints[b].position.x, joints[b].position.y, joints[b].position.z);
        });
        pos.needsUpdate = true;
      }
      if (view === 'orbit') {
        ang += 0.004;
        camera.position.set(Math.sin(ang) * 2.6, 0.5, Math.cos(ang) * 2.6);
        camera.lookAt(0, -0.1, 0);
      } else {
        setCam(view);
      }
      renderer.render(scene, camera);
    };
    render();
    const onResize = () => {
      const w = mount.clientWidth || 400; const h = mount.clientHeight || 320;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 p-2" role="group" aria-label="3D camera view">
        {(['orbit', 'front', 'side', 'rear', 'top'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded px-2 py-1 text-[10px] font-bold tracking-widest ${view === v ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/50' : 'bg-white/5 text-slate-400 ring-1 ring-white/10'}`}
          >
            {v.toUpperCase()}
          </button>
        ))}
        <span className="ml-auto self-center text-[10px] text-slate-500">2D feed remains primary clinical view</span>
      </div>
      {glError ? (
        <p className="flex min-h-[280px] flex-1 items-center justify-center p-6 text-center text-xs text-slate-500">
          3D view needs WebGL, which this device/browser blocked ({glError}). The 2D camera feed remains the primary clinical view.
        </p>
      ) : (
        <div ref={mountRef} className="min-h-[280px] flex-1" aria-label="3D body visualization" />
      )}
    </div>
  );
}
