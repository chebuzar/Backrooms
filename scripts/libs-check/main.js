// Перевірка, що всі встановлені бібліотеки завантажуються і працюють поверх three 0.160.
// Запускає scripts/libs-check.mjs; результат — у window.__libs.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { init as initRecast } from 'recast-navigation';
import { threeToSoloNavMesh, DebugDrawer } from '@recast-navigation/three';
import * as YUKA from 'yuka';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import Stats from 'stats-gl';
import GUI from 'lil-gui';

const out = {};
const step = async (name, fn) => {
  try { out[name] = { ok: true, info: await fn() }; } catch (e) { out[name] = { ok: false, info: String(e && e.stack || e) }; }
};

const renderer = new THREE.WebGLRenderer();
renderer.setSize(320, 240);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100);
camera.position.set(0, 8, 12); camera.lookAt(0, 0, 0);
const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.2, 20), new THREE.MeshBasicMaterial({ color: 0x444444 }));
const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 10), new THREE.MeshBasicMaterial({ color: 0x886633 }));
wall.position.set(0, 1.5, 0);
scene.add(floor, wall);
scene.updateMatrixWorld(true);

await step('rapier', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.1, 10));
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
  world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
  for (let i = 0; i < 180; i++) world.step();
  const y = body.translation().y;
  if (!(y > 0.4 && y < 0.8)) throw new Error('ball did not land on floor, y=' + y);
  return 'rapier ' + RAPIER.version() + ', ball rests at y=' + y.toFixed(2);
});

await step('recast', async () => {
  await initRecast();
  const { success, navMesh } = threeToSoloNavMesh([floor, wall], { cs: 0.2, ch: 0.2, walkableRadius: 2 });
  if (!success) throw new Error('navmesh failed');
  const { NavMeshQuery } = await import('recast-navigation');
  const q = new NavMeshQuery(navMesh);
  const { success: ok, path } = q.computePath({ x: -5, y: 0.1, z: 0 }, { x: 5, y: 0.1, z: 0 });
  if (!ok || path.length < 3) throw new Error('no path around wall');
  const dd = new DebugDrawer(); dd.drawNavMesh(navMesh); scene.add(dd);
  return 'path around wall: ' + path.length + ' points';
});

await step('yuka', () => {
  const mgr = new YUKA.EntityManager();
  const v = new YUKA.Vehicle(); v.maxSpeed = 2;
  v.steering.add(new YUKA.SeekBehavior(new YUKA.Vector3(10, 0, 0)));
  mgr.add(v);
  for (let i = 0; i < 60; i++) mgr.update(1 / 30);
  const vis = new YUKA.Vision(v); vis.range = 20; vis.fieldOfView = Math.PI * 0.75;
  const sees = vis.visible(new YUKA.Vector3(v.position.x + 5, 0, 0));
  if (v.position.x <= 1) throw new Error('vehicle did not move');
  return 'vehicle x=' + v.position.x.toFixed(2) + ', vision sees target: ' + sees;
});

await step('bvh', () => {
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  wall.geometry.boundsTree = new MeshBVH(wall.geometry);
  const rc = new THREE.Raycaster(new THREE.Vector3(-5, 1.5, 0), new THREE.Vector3(1, 0, 0));
  rc.firstHitOnly = true;
  const hit = rc.intersectObject(wall)[0];
  if (!hit) throw new Error('no hit');
  return 'ray hit wall at x=' + hit.point.x.toFixed(2);
});

await step('statsgl', async () => {
  const stats = new Stats({ trackGPU: true });
  document.body.appendChild(stats.dom);
  await stats.init(renderer);
  for (let i = 0; i < 5; i++) { stats.begin(); renderer.render(scene, camera); stats.end(); stats.update(); }
  return 'panel added, GPU timer: ' + (stats.gpuPanel ? 'yes' : 'no (browser has no timer query)');
});

await step('lilgui', () => {
  const gui = new GUI({ title: 'debug' });
  const p = { exposure: 1 };
  gui.add(p, 'exposure', 0, 2);
  gui.controllers[0].setValue(1.5);
  if (p.exposure !== 1.5) throw new Error('control did not update value');
  return 'controls: ' + gui.controllers.length;
});

renderer.render(scene, camera);
window.__libs = out;
