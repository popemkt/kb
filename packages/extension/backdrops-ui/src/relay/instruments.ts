import {
  Box3,
  DirectionalLight,
  PointLight,
  type Material,
  MeshStandardMaterial,
  type Group,
  Mesh,
  type Object3D,
} from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { instrumentFinish, quayProbe } from "./machine-finish";
import modelUrl from "./instruments.glb?url&inline";
import type { Finishes } from "./finishes";

function part(root: Group, name: string) {
  const object = root.getObjectByName(name);
  if (!object) throw new Error(`Missing instrument part: ${name}`);
  return object;
}

/** The editable Blender scene owns geometry, moving pivots and the two cloth shapes.
 * The backdrop owns the call timing and the light shared with the harbour. */
export function instruments(parent: Group, finishes: Finishes) {
  const probe = quayProbe();
  const key = new DirectionalLight(0xffe9bc, 1.9);
  key.position.set(-3.4, 5, 3.7);
  const rim = new DirectionalLight(0xa1d9ff, 1.35);
  rim.position.set(4, 3, -2);
  const valveLight = new PointLight(0xffab50, 0, 2.3);
  valveLight.position.set(1.23, 2.31, 0.5);
  parent.add(key, rim, valveLight);
  const bounds = new Box3();
  let movingParts: { lever: Object3D; needle: Object3D; sleeve: Object3D } | undefined;
  const commonFinishes = new Map<string, Material>(Object.entries(finishes));
  const fabric: number[][] = [];
  async function load() {
    const buffer = await (await fetch(modelUrl)).arrayBuffer();
    const { scene } = await new GLTFLoader().parseAsync(buffer, "");
    parent.add(scene);
    const lever = part(scene, "CallLever");
    const needle = part(scene, "GaugeNeedle");
    const sleeve = part(scene, "WindSleeve");
    const machine = part(scene, "Machine");
    bounds.setFromObject(machine);
    const metalwork = new Set([
      "violet",
      "green",
      "dark",
      "gold",
      "copper",
      "paper",
      "ceramic",
      "bakelite",
    ]);
    const surface = new Map<Material, Material>();
    const machineParts = new Set<Object3D>();
    machine.traverse((object) => machineParts.add(object));
    const imported = new Set<Material>();
    scene.traverse((mesh) => {
      if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshStandardMaterial)) return;
      const original = mesh.material;
      imported.add(original);
      const name = original.name;
      if (machineParts.has(mesh) && metalwork.has(name)) {
        const finish = surface.get(original) ?? instrumentFinish(original, probe);
        surface.set(original, finish);
        mesh.material = finish;
      } else {
        const finish = commonFinishes.get(name);
        if (!finish) throw new Error(`Unknown instrument finish: ${name}`);
        mesh.material = finish;
      }
      if (mesh.morphTargetInfluences) fabric.push(mesh.morphTargetInfluences);
    });
    for (const material of imported) material.dispose();
    movingParts = { lever, needle, sleeve };
  }
  return {
    dispose: () => probe.dispose(),
    setDaylight(day: boolean) {
      key.color.set(day ? 0xffefcf : 0xffe9bc);
      key.intensity = day ? 3.4 : 1.9;
      key.position.set(day ? -1.8 : -3.4, day ? 7 : 5, 3.7);
      rim.intensity = day ? 1.9 : 1.35;
    },
    bounds,
    ready: load(),
    pose(time: number, leverAngle: number, needleAngle: number, pulse: number, gust: number) {
      if (!movingParts) return;
      const { lever, needle, sleeve } = movingParts;
      valveLight.intensity = pulse * 1.25;
      lever.rotation.z = leverAngle;
      needle.rotation.z = needleAngle;
      sleeve.rotation.z = -0.18 * gust;
      for (const weights of fabric) {
        weights[0] = Math.cos(time * 1.4);
        weights[1] = -Math.sin(time * 1.4);
      }
    },
  };
}
