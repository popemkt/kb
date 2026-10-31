#!/bin/sh
# EXPERIMENT: build the datom kernel's wasm and its bindings into src/pkg.
# Run from the repository root: `nix develop .#wasm -c sh packages/infrastructure/datom-kernel-wasm/scripts/build.sh`
# (rustc, cargo, lld, wasm-bindgen-cli, binaryen).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
cargo build --manifest-path "$here/crate/Cargo.toml" --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir "$here/src/pkg" \
  "$here/crate/target/wasm32-unknown-unknown/release/datom_kernel.wasm"
wasm-opt -O3 --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext \
  "$here/src/pkg/datom_kernel_bg.wasm" -o "$here/src/pkg/datom_kernel_bg.wasm"
