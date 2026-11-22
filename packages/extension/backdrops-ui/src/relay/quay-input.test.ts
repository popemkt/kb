import { expect, it, vi } from "vitest";
import { Box3, PerspectiveCamera, Vector2, Vector3 } from "three/webgpu";
import { quayInput } from "./quay-input";

function setup(width: number) {
  const size = new Vector2(width, 300);
  const camera = new PerspectiveCamera(27.3, width / size.y, 0.1, 65);
  camera.position.set(0.8, 1.7, 7.3);
  camera.lookAt(0, 1.45, 0);
  camera.updateMatrixWorld();
  const splash = vi.fn();
  const read = quayInput(new Box3(new Vector3(0.6, 0.1, -0.4), new Vector3(2.4, 3, 0.6)), splash);
  function point(pos: Vector3) {
    const projected = pos.clone().project(camera);
    return {
      near: 1,
      speed: 0,
      x: ((projected.x + 1) * width) / 2,
      y: ((1 - projected.y) * size.y) / 2,
    };
  }
  return { read, point, camera, size, splash };
}

it.each([432, 960])(
  "a held pointer calls once and rearms after leaving the relay at width %i",
  (w) => {
    const { read, point, camera, size } = setup(w);
    const p = point(new Vector3(1.46, 1.5, 0.4));
    let calls = 0;
    for (let i = 0; i < 25; i++) if (read(p, camera, size, i * 0.05, 0.05)) calls++;
    expect(calls).toBe(1);
    read({ ...p, near: 0 }, camera, size, 1.26, 0.01);
    for (let i = 0; i < 14; i++) if (read(p, camera, size, 1.27 + i * 0.05, 0.05)) calls++;
    expect(calls).toBe(2);
  },
);
it("a moving pointer hits the water in world space, and a held or paused pointer adds no trail", () => {
  const { read, point, camera, size, splash } = setup(720);
  const a = point(new Vector3(-0.3, -0.055, -0.8));
  read(a, camera, size, 2, 0.04);
  expect(splash).toHaveBeenCalledTimes(1);
  expect(splash.mock.calls[0]?.[0]).toBeCloseTo(-0.3);
  expect(splash.mock.calls[0]?.[1]).toBeCloseTo(-0.8);
  read(a, camera, size, 2.3, 0.04);
  const b = point(new Vector3(0.05, -0.055, -0.9));
  read(b, camera, size, 2.5, 0);
  expect(splash).toHaveBeenCalledTimes(1);
  read(b, camera, size, 2.54, 0.04);
  expect(splash).toHaveBeenCalledTimes(2);
});
