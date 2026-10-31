/* tslint:disable */
/* eslint-disable */

export class Index {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Build both permutations. The columns are copied in by the binding.
     */
    constructor(e: Uint32Array, a: Uint32Array, t: Uint8Array, v: Float64Array);
    /**
     * Answer an encoded query; returns the row width. Rows are read back
     * with `tags()` and `values()`.
     */
    run(q: Float64Array): number;
    /**
     * The last run's cell tags, row by row.
     */
    tags(): Uint8Array;
    /**
     * The last run's cell values, row by row.
     */
    values(): Float64Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_index_free: (a: number, b: number) => void;
    readonly index_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly index_run: (a: number, b: number, c: number) => number;
    readonly index_tags: (a: number, b: number) => void;
    readonly index_values: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
