// OSM tag -> 3D asset builders (all Three.js primitives, no downloads).
// placeProps(props, ctx) mutates the scene; spinners/lampGlows are output
// registries the engine animates (turbine rotors, night-glowing lamps).
import * as THREE from "three";

export function placeProps(props, { scene, groundHeight, spinners, lampGlows }) {
const grey = new THREE.MeshLambertMaterial({ color: 0x555b64 });
const dark = new THREE.MeshLambertMaterial({ color: 0x3a3f47 });
const white = new THREE.MeshLambertMaterial({ color: 0xe8e6e0 });
const red = new THREE.MeshLambertMaterial({ color: 0xb3402f });
const wood = new THREE.MeshLambertMaterial({ color: 0x7a5c3e });
const green2 = new THREE.MeshLambertMaterial({ color: 0x3f6d4e });
const glowMat = () => new THREE.MeshBasicMaterial({ color: 0x1a1c20 }); // off; night turns it on
const add = (mesh, x, z, y = 0) => {
  mesh.position.set(x, groundHeight(x, z) + y, z);
  scene.add(mesh);
  return mesh;
};
const cyl = (r1, r2, h, mat, seg = 8) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
const BUILDERS = {
  lamp(x, z) {
    const g = new THREE.Group();
    const pole = cyl(0.07, 0.09, 4.4, grey); pole.position.y = 2.2; g.add(pole);
    const arm = box(1.1, 0.08, 0.08, grey); arm.position.set(0.5, 4.35, 0); g.add(arm);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), glowMat());
    bulb.position.set(1.0, 4.25, 0); g.add(bulb);
    lampGlows.push(bulb.material);
    add(g, x, z);
  },
  signals(x, z) {
    const g = new THREE.Group();
    const pole = cyl(0.06, 0.08, 3.4, dark); pole.position.y = 1.7; g.add(pole);
    const head = box(0.28, 0.8, 0.2, dark); head.position.y = 3.6; g.add(head);
    for (const [dy, c] of [[0.24, 0xd94040], [0, 0xe8c33a], [-0.24, 0x43b05c]]) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: c }));
      dot.position.set(0, 3.6 + dy, 0.11); g.add(dot);
    }
    add(g, x, z);
  },
  bus_stop(x, z) {
    const g = new THREE.Group();
    for (const ox of [-1.4, 1.4]) { const p2 = cyl(0.05, 0.05, 2.4, grey); p2.position.set(ox, 1.2, 0); g.add(p2); }
    const roof = box(3.2, 0.08, 1.2, dark); roof.position.y = 2.45; g.add(roof);
    const back = box(3.0, 1.4, 0.05, new THREE.MeshLambertMaterial({ color: 0x8fb2c9, transparent: true, opacity: 0.6 }));
    back.position.set(0, 1.5, -0.55); g.add(back);
    add(g, x, z);
  },
  bench(x, z) {
    const g = new THREE.Group();
    const seat = box(1.6, 0.06, 0.4, wood); seat.position.y = 0.45; g.add(seat);
    const back = box(1.6, 0.4, 0.05, wood); back.position.set(0, 0.75, -0.18); g.add(back);
    for (const ox of [-0.7, 0.7]) { const leg = box(0.06, 0.45, 0.36, dark); leg.position.set(ox, 0.22, 0); g.add(leg); }
    add(g, x, z);
  },
  fountain(x, z) {
    const g = new THREE.Group();
    const basin = cyl(2.2, 2.4, 0.5, white, 14); basin.position.y = 0.25; g.add(basin);
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.0, 14), new THREE.MeshBasicMaterial({ color: 0x5fb3e8 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.52; g.add(water);
    const jet = cyl(0.12, 0.2, 1.4, white); jet.position.y = 1.0; g.add(jet);
    add(g, x, z);
  },
  bin(x, z) { add(cyl(0.22, 0.18, 0.7, dark), x, z, 0.35); },
  phone(x, z) { add(box(1.0, 2.4, 1.0, red), x, z, 1.2); },
  billboard(x, z) {
    const g = new THREE.Group();
    for (const ox of [-1.6, 1.6]) { const p2 = cyl(0.09, 0.09, 3.2, grey); p2.position.set(ox, 1.6, 0); g.add(p2); }
    const panel = box(4.4, 2.4, 0.12, white); panel.position.y = 4.2; g.add(panel);
    add(g, x, z);
  },
  flagpole(x, z) {
    const g = new THREE.Group();
    const pole = cyl(0.05, 0.07, 7, white); pole.position.y = 3.5; g.add(pole);
    const flag = box(1.4, 0.9, 0.02, red); flag.position.set(0.72, 6.4, 0); g.add(flag);
    add(g, x, z);
  },
  comm_tower(x, z) {
    const g = new THREE.Group();
    const t1 = cyl(1.2, 1.8, 10, grey, 6); t1.position.y = 5; g.add(t1);
    const t2 = cyl(0.5, 1.1, 10, grey, 6); t2.position.y = 15; g.add(t2);
    const ant = cyl(0.08, 0.08, 8, dark); ant.position.y = 24; g.add(ant);
    add(g, x, z);
  },
  chimney(x, z) { add(cyl(1.2, 1.8, 26, new THREE.MeshLambertMaterial({ color: 0x9c6b5a }), 10), x, z, 13); },
  water_tower(x, z) {
    const g = new THREE.Group();
    const leg = cyl(0.9, 1.4, 12, grey, 8); leg.position.y = 6; g.add(leg);
    const tank = new THREE.Mesh(new THREE.SphereGeometry(3.4, 12, 8), white); tank.position.y = 14; g.add(tank);
    add(g, x, z);
  },
  windmill(x, z) {
    const g = new THREE.Group();
    const body = cyl(2.2, 3.2, 9, white, 10); body.position.y = 4.5; g.add(body);
    for (let i = 0; i < 4; i++) {
      const blade = box(0.5, 4.5, 0.08, wood);
      blade.position.set(0, 9 + Math.cos((i * Math.PI) / 2) * 2.6, 2.4);
      blade.position.x = Math.sin((i * Math.PI) / 2) * 2.6;
      blade.rotation.z = (i * Math.PI) / 2;
      g.add(blade);
    }
    add(g, x, z);
  },
  turbine(x, z) {
    const g = new THREE.Group();
    const pole = cyl(0.8, 1.6, 40, white, 10); pole.position.y = 20; g.add(pole);
    const nac = box(2.4, 1.4, 1.4, white); nac.position.y = 40.6; g.add(nac);
    const rotor = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const blade = box(0.5, 14, 0.12, white);
      blade.position.y = 7;
      const hold = new THREE.Group();
      hold.rotation.z = (i * Math.PI * 2) / 3;
      hold.add(blade); rotor.add(hold);
    }
    rotor.position.set(0, 40.6, 1.0);
    g.add(rotor);
    spinners.push(rotor);
    add(g, x, z);
  },
  lighthouse(x, z) {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const seg = cyl(1.6 - i * 0.14, 1.75 - i * 0.14, 3.2, i % 2 ? red : white, 10);
      seg.position.y = 1.6 + i * 3.2; g.add(seg);
    }
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
    light.position.y = 17.4; g.add(light);
    add(g, x, z);
  },
  silo(x, z) { add(cyl(2.6, 2.6, 11, white, 10), x, z, 5.5); },
  crane(x, z) {
    const g = new THREE.Group();
    const t = box(1.2, 22, 1.2, new THREE.MeshLambertMaterial({ color: 0xd9a13a })); t.position.y = 11; g.add(t);
    const jib = box(16, 0.8, 0.8, new THREE.MeshLambertMaterial({ color: 0xd9a13a })); jib.position.set(6.5, 22, 0); g.add(jib);
    add(g, x, z);
  },
  obelisk(x, z) { add(cyl(0.4, 1.0, 9, white, 4), x, z, 4.5); },
  bollard(x, z) { add(cyl(0.12, 0.12, 0.8, dark, 6), x, z, 0.4); },
  gate(x, z) { add(box(2.6, 0.12, 0.12, grey), x, z, 1.0); },
  subway(x, z) {
    const g = new THREE.Group();
    const frame = box(3.2, 0.4, 2.4, grey); frame.position.y = 1.1; g.add(frame);
    for (const ox of [-1.5, 1.5]) { const w = box(0.15, 1.2, 2.4, grey); w.position.set(ox, 0.6, 0); g.add(w); }
    const sign = box(0.8, 0.8, 0.1, new THREE.MeshBasicMaterial({ color: 0x2255cc })); sign.position.y = 2.0; g.add(sign);
    add(g, x, z);
  },
  peak(x, z, tags) {
    const g = new THREE.Group();
    const v1 = box(0.12, 2.2, 0.12, wood); v1.position.y = 1.1; g.add(v1);
    const v2 = box(1.1, 0.12, 0.12, wood); v2.position.y = 1.7; g.add(v2);
    add(g, x, z);
  },
  memorial(x, z) {
    const g = new THREE.Group();
    const base = box(1.6, 0.5, 1.6, grey); base.position.y = 0.25; g.add(base);
    const col = cyl(0.25, 0.35, 2.4, white, 6); col.position.y = 1.7; g.add(col);
    add(g, x, z);
  },
  pylon(x, z) {
    const g = new THREE.Group();
    const t = cyl(0.5, 1.6, 24, grey, 4); t.position.y = 12; g.add(t);
    const cross = box(9, 0.3, 0.3, grey); cross.position.y = 21; g.add(cross);
    add(g, x, z);
  },
};
let placed = 0;
for (const pr of props) {
  if (placed > 400) break;
  const b = BUILDERS[pr.kind];
  if (b) { b(pr.x, pr.z, pr.tags); placed++; }
}
}
