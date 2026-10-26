import * as THREE from 'three';

/**
 * Move the visible meshes so their bounds sit on the orbit target, then place
 * the camera far enough that the whole model stays inside the current frame.
 * Generated GLBs keep each part at its millimetre position, so the raw file
 * is not centred on the origin.
 */
export function frameGlbRoot(root: THREE.Object3D, camera: THREE.PerspectiveCamera): THREE.Vector3 {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root, true);
  const fallback = new THREE.Vector3(1.6, 1.1, 1.8);
  if (box.isEmpty()) return fallback;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const aspect = camera.aspect > 0 ? camera.aspect : 1;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const halfH = Math.max(size.y, 0.001) / 2;
  const halfW = Math.max(size.x, size.z, 0.001) / 2;
  const distV = halfH / Math.tan(vFov / 2);
  const distH = halfW / Math.tan(vFov / 2) / aspect;
  const distance = Math.max(distV, distH, 0.2) * 1.45;
  const home = new THREE.Vector3(0.62, 0.48, 0.82).normalize().multiplyScalar(distance);
  camera.near = Math.max(distance / 200, 0.01);
  camera.far = Math.max(distance * 40, 10);
  camera.position.copy(home);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return home;
}
