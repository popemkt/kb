// The surface contract's tcp-required cell over every surface (`surfaces.ts`).
import { SURFACE_CONTRACT_CELLS, surfaceContract } from "@kb/test-kit";
import { SURFACES } from "./surfaces.ts";

surfaceContract(SURFACES, SURFACE_CONTRACT_CELLS["tcp-required"]);
