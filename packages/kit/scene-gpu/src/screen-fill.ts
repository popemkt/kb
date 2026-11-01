/**
 * `screenFill`: a scene's background drawn on a quad that covers the frame
 * exactly, behind everything, under any projection. It lies on the far
 * plane and is drawn after the opaque solids, so the depth test skips every
 * pixel a solid covers: the background is shaded only where it shows. three draws
 * `scene.backgroundNode` on a sphere about the eye, which an orthographic
 * view scales to three times its half-height (three's own safety factor):
 * a frame wider than about 2.8 times its height shows past it at the
 * corners, as a page head does. An orthographic stage (`Projection`) draws
 * its background with this instead.
 */
import { positionGeometry, vec4 } from "three/tsl";
import { Mesh, MeshBasicNodeMaterial, PlaneGeometry } from "three/webgpu";
import type { TslNode } from "./tsl";

/** A mesh covering the frame in clip space on the far plane, drawn after the opaque solids, coloured by `color`. */
export function screenFill(color: TslNode<"vec3">): Mesh {
  const material = new MeshBasicNodeMaterial();
  material.depthWrite = false;
  material.fog = false;
  material.vertexNode = vec4(positionGeometry.xy, 1, 1);
  material.colorNode = color;
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  // Last of the opaque: what the solids cover fails the depth test before it is shaded.
  mesh.renderOrder = 1e6;
  return mesh;
}
