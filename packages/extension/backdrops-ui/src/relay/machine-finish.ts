import {
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  MeshPhysicalNodeMaterial,
  RGBAFormat,
  MeshPhysicalMaterial,
  type MeshStandardMaterial,
} from "three/webgpu";
import { mix, mx_noise_float, positionWorld, smoothstep, vec3 } from "three/tsl";

/** A reflection probe approximating the lit shop windows and the blue opening in
 * the cloud cover. Half-float radiance keeps the practicals brighter than the sky. */
export function quayProbe() {
  const width = 128,
    height = 64;
  const pixels = new Uint16Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const elevation = Math.PI * ((j + 0.5) / height - 0.5);
    for (let i = 0; i < width; i++) {
      const azimuth = 2 * Math.PI * ((i + 0.5) / width - 0.5);
      const x = Math.cos(elevation) * Math.cos(azimuth);
      const y = Math.sin(elevation);
      const z = Math.cos(elevation) * Math.sin(azimuth);
      const sky = 0.13 + 0.48 * Math.max(0, y);
      const window = Math.exp(-2 * ((x + 0.73) / 0.34) ** 4 - 2 * ((y - 0.23) / 0.31) ** 4);
      const cool = Math.exp(-(((x - 0.68) / 0.28) ** 2) - ((y - 0.45) / 0.48) ** 2);
      const bounce = Math.max(0, z) * 0.16;
      const bands = [
        sky * 0.64 + 4 * window + cool + bounce,
        sky * 0.84 + 3.4 * window + 2 * cool + bounce,
        sky * 1.25 + 1.7 * window + 2.8 * cool + bounce,
        1,
      ];
      pixels.set(
        bands.map((value) => DataUtils.toHalfFloat(value)),
        (j * width + i) * 4,
      );
    }
  }
  const probe = new DataTexture(pixels, width, height, RGBAFormat, HalfFloatType);
  probe.mapping = EquirectangularReflectionMapping;
  probe.colorSpace = LinearSRGBColorSpace;
  probe.minFilter = probe.magFilter = LinearFilter;
  probe.needsUpdate = true;
  return probe;
}

export function instrumentFinish(source: MeshStandardMaterial, probe: DataTexture) {
  const finish = new MeshPhysicalNodeMaterial();
  finish.color.copy(source.color);
  finish.metalness = source.metalness;
  finish.roughness = source.roughness;
  if (source instanceof MeshPhysicalMaterial) {
    finish.clearcoat = source.clearcoat;
    finish.clearcoatRoughness = source.clearcoatRoughness;
  }
  finish.envMap = probe;
  const runoff = mx_noise_float(positionWorld.mul(vec3(8, 1.5, 8)));
  finish.roughnessNode = runoff.mul(0.09).add(finish.roughness).clamp(0.11, 0.83);
  const base = vec3(source.color.r, source.color.g, source.color.b);
  if (source.name === "violet" || source.name === "green") {
    const stipple = mx_noise_float(positionWorld.mul(31));
    const weather = smoothstep(0.12, 0.58, runoff.add(stipple.mul(0.26)));
    finish.colorNode = base.mul(stipple.mul(0.075).add(1)).mul(weather.mul(-0.19).add(1));
    finish.clearcoatRoughnessNode = weather.mul(0.17).add(0.15);
  }
  if (source.name === "copper") {
    const oxide = smoothstep(0.19, 0.62, runoff);
    finish.colorNode = mix(base, vec3(0.064, 0.22, 0.17), oxide);
    finish.metalnessNode = oxide.mul(-0.72).add(finish.metalness);
  }
  return finish;
}
