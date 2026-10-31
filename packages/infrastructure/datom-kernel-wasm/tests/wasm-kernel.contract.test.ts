import { datomKernelContract } from "@kb/test-kit";
import { DATOM_KERNEL_WASM_URL, wasmKernel } from "../src/index.ts";

datomKernelContract(wasmKernel(await Bun.file(DATOM_KERNEL_WASM_URL).arrayBuffer()));
