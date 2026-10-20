import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type ViewportTool = 'rotate' | 'pan' | 'zoom';

/**
 * GLB preview. Official millimetre size is drawn by the parent, not measured off the mesh.
 */
export function GlbViewport({
  url,
  tool,
  wireframe,
  showMaterial,
  resetKey,
  onProgress,
  onReady,
  onFailed,
}: {
  url: string;
  tool: ViewportTool;
  wireframe: boolean;
  showMaterial: boolean;
  resetKey: number;
  onProgress: (label: string) => void;
  onReady: () => void;
  onFailed: (message: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rootRef = useRef<THREE.Group | null>(null);
  const homeRef = useRef(new THREE.Vector3(1.6, 1.1, 1.8));
  const lookRef = useRef<() => void>(() => undefined);
  const wireRef = useRef(wireframe);
  const materialRef = useRef(showMaterial);
  wireRef.current = wireframe;
  materialRef.current = showMaterial;
  const seenReset = useRef(resetKey);
  const progressRef = useRef(onProgress);
  const readyRef = useRef(onReady);
  const failedRef = useRef(onFailed);
  progressRef.current = onProgress;
  readyRef.current = onReady;
  failedRef.current = onFailed;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const flat = new THREE.MeshStandardMaterial({ color: 0xc8c2b4, roughness: 0.72, metalness: 0.04 });

    const applyLook = () => {
      const root = rootRef.current;
      if (!root) return;
      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        if (!originals.has(obj)) originals.set(obj, obj.material);
        obj.material = materialRef.current ? originals.get(obj)! : flat;
        const current = Array.isArray(obj.material) ? obj.material : [obj.material];
        current.forEach((mat) => {
          mat.wireframe = wireRef.current;
        });
      });
    };
    lookRef.current = applyLook;

    let canvas: HTMLCanvasElement;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      canvas = renderer.domElement;
    } catch {
      failedRef.current('這部裝置開不了 WebGL');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf7f8fb, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    cameraRef.current = camera;
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    const root = new THREE.Group();
    rootRef.current = root;
    scene.add(root);

    const fit = () => {
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      root.position.sub(center);
      const max = Math.max(size.x, size.y, size.z, 0.2);
      homeRef.current.set(max * 1.35, max * 0.85, max * 1.55);
      camera.near = max / 100;
      camera.far = max * 40;
      camera.position.copy(homeRef.current);
      controls.target.set(0, 0, 0);
      controls.update();
      camera.updateProjectionMatrix();
    };

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer?.setSize(w, h, false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const onLost = (event: Event) => {
      event.preventDefault();
      failedRef.current('顯示卡中斷了預覽，請重試');
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        if (disposed) return;
        root.clear();
        originals.clear();
        root.add(gltf.scene);
        applyLook();
        fit();
        readyRef.current();
      },
      (event) => {
        if (disposed) return;
        if (event.lengthComputable && event.total > 0) {
          progressRef.current(`載入 ${Math.round((event.loaded / event.total) * 100)}%`);
        } else {
          progressRef.current('載入中');
        }
      },
      () => {
        if (!disposed) failedRef.current('模型載入失敗，檔案可能已過期或損壞');
      },
    );

    const tick = () => {
      if (disposed) return;
      controls.update();
      renderer?.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      controls.dispose();
      controlsRef.current = null;
      cameraRef.current = null;
      rootRef.current = null;
      originals.forEach((mat) => {
        (Array.isArray(mat) ? mat : [mat]).forEach((item) => item.dispose());
      });
      flat.dispose();
      renderer?.dispose();
      canvas.remove();
    };
  }, [url]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (controls) {
      controls.mouseButtons = {
        LEFT: tool === 'pan' ? THREE.MOUSE.PAN : tool === 'zoom' ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      controls.touches = {
        ONE: tool === 'pan' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      };
    }
    lookRef.current();
  }, [tool, wireframe, showMaterial]);

  useEffect(() => {
    if (seenReset.current === resetKey) return;
    seenReset.current = resetKey;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.position.copy(homeRef.current);
    controls.target.set(0, 0, 0);
    controls.update();
  }, [resetKey]);

  return <div ref={hostRef} className="h-full w-full" />;
}
