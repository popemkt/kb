/**
 * EXPERIMENT (docs/research/2026-10-31-rust-wasm-in-kb.md): `@kb/query`'s
 * datom kernel contract, implemented in Rust and compiled to WebAssembly.
 *
 * The wasm and its wasm-bindgen glue under `./pkg` are built by
 * `scripts/build.sh` and committed, so neither Bun nor the page build needs
 * a Rust toolchain. The caller supplies the bytes — a `fetch` of
 * `DATOM_KERNEL_WASM_URL` in the page, a file read in Bun — so this module
 * stays isomorphic and instantiates synchronously once it has them.
 */
import type { DatomKernel, Encoded, KernelIndex } from "@kb/query";
import { Index, initSync } from "./pkg/datom_kernel.js";

/** Where the module's bytes are, beside this file. */
export const DATOM_KERNEL_WASM_URL: URL = new URL("./pkg/datom_kernel_bg.wasm", import.meta.url);

class WasmIndex implements KernelIndex {
  readonly #index: Index;

  constructor(encoded: Encoded) {
    this.#index = new Index(encoded.e, encoded.a, encoded.t, encoded.v);
  }

  run(query: Float64Array): { width: number; tags: Uint8Array; values: Float64Array } {
    const width = this.#index.run(query);
    return { width, tags: this.#index.tags(), values: this.#index.values() };
  }

  free(): void {
    this.#index.free();
  }
}

/** The kernel, over a compiled or raw copy of the module. */
export function wasmKernel(module: ArrayBuffer | Uint8Array | WebAssembly.Module): DatomKernel {
  initSync({ module });
  return { name: "rust-wasm", build: (encoded) => new WasmIndex(encoded) };
}
