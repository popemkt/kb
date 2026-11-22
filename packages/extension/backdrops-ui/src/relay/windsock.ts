import { CylinderGeometry, DoubleSide, Mesh, type Group } from "three/webgpu";
import { dot, fract, mix, normalWorld, sin, smoothstep, uv, vec3 } from "three/tsl";
import { flat } from "./finishes";

/** The throat is fixed to the tide staff. A travelling bend reaches the
 * tapered end later, rolling the cloth around its axis as it loses lift. */
export function windsock(parent: Group) {
  const length = 1.23;
  const geometry = new CylinderGeometry(0.073, 0.188, length, 24, 20, true);
  const vertices = geometry.getAttribute("position");
  const rest = vertices.clone();
  const stripe = fract(uv().y.mul(3.4));
  const sail = mix(vec3(0.48, 0.071, 0.037), vec3(0.64, 0.53, 0.32), smoothstep(0.5, 0.54, stripe));
  const light = smoothstep(-0.18, 0.08, dot(normalWorld, vec3(-0.48, 0.7, 0.45)))
    .mul(0.64)
    .add(0.21);
  const seam = smoothstep(0.78, 0.99, sin(uv().x.mul(Math.PI * 16)));
  const cloth = flat(sail.mul(light).mul(seam.mul(-0.16).add(1)));
  cloth.side = DoubleSide;
  const mesh = new Mesh(geometry, cloth);
  mesh.position.set(3.69, 2.86, 0.125);
  parent.add(mesh);
  function settle(time: number) {
    for (let i = 0; i < vertices.count; i++) {
      const u = (rest.getY(i) + length / 2) / length;
      const wave = 5 * u - 1.4 * time;
      vertices.setXYZ(
        i,
        -u * length,
        rest.getX(i) - 0.31 * u + u * (0.124 * Math.sin(wave) + 0.048 * Math.sin(2 * wave)),
        rest.getZ(i) + u * (0.09 * Math.cos(wave) + 0.1),
      );
    }
    vertices.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  settle(0);
  return settle;
}
