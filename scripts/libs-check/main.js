// Перевірка, що всі встановлені бібліотеки завантажуються і працюють поверх three 0.160.
// Запускає scripts/libs-check.mjs; результат — у window.__libs.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { init as initRecast } from 'recast-navigation';
import { threeToSoloNavMesh, DebugDrawer } from '@recast-navigation/three';
import * as YUKA from 'yuka';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import Stats from 'stats-gl';
import { Pane } from 'tweakpane';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

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

await step('tweakpane', () => {
  const pane = new Pane({ title: 'debug' });
  const p = { exposure: 1 };
  const b = pane.addBinding(p, 'exposure', { min: 0, max: 2 });
  p.exposure = 1.5; pane.refresh();
  const graph = pane.addBinding({ fps: 60 }, 'fps', { readonly: true, view: 'graph', min: 0, max: 120 });
  if (!b || !graph) throw new Error('bindings not created');
  return 'binding + fps graph created';
});

await step('csg', () => {
  // Doorway cut into a wall: wall minus box.
  const wallB = new Brush(new THREE.BoxGeometry(4, 3, 0.2));
  const door = new Brush(new THREE.BoxGeometry(1, 2.1, 0.5));
  door.position.set(0, -0.45, 0); door.updateMatrixWorld();
  wallB.updateMatrixWorld();
  const res = new Evaluator().evaluate(wallB, door, SUBTRACTION);
  const tris = res.geometry.index ? res.geometry.index.count / 3 : res.geometry.attributes.position.count / 3;
  const rc = new THREE.Raycaster(new THREE.Vector3(0, -0.5, 2), new THREE.Vector3(0, 0, -1));
  const throughDoor = rc.intersectObject(res).length === 0;
  const rc2 = new THREE.Raycaster(new THREE.Vector3(1.5, 0, 2), new THREE.Vector3(0, 0, -1));
  const hitsWall = rc2.intersectObject(res).length > 0;
  if (!throughDoor || !hitsWall) throw new Error('doorway not cut: through=' + throughDoor + ' wall=' + hitsWall);
  return 'wall with doorway: ' + tris + ' triangles, ray passes through door';
});

await step('noise', () => {
  const n = new SimplexNoise({ random: (() => { let s = 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })() });
  const v = [n.noise(0.1, 0.2), n.noise3d(1.3, 2.1, 0.7), n.noise(5.5, 3.3)];
  if (v.some((x) => !(x >= -1 && x <= 1)) || v[0] === v[2]) throw new Error('bad noise ' + v);
  return 'three/addons SimplexNoise: ' + v.map((x) => x.toFixed(3)).join(', ');
});

renderer.render(scene, camera);
window.__libs = out;
