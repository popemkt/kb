{
  lib,
  stdenvNoCC,
  bun,
  bun2nix,
  makeBinaryWrapper,
  callPackage,
}:

# Single entry point: one `kb` binary with the SPA baked beside it.
# Operator never minds KB_UI_DIST — the wrapper sets KB_PKG_ROOT so
# paths.ts resolves `$out/lib/kb/packages/app/ui/dist` the same as a checkout.
#
# Dependencies come from bun.nix, which bun2nix generates from bun.lock (kb's
# `postinstall`; its harness fails a stale copy). Each package is fetched
# against the hash the lockfile already records, and the build itself is an
# ordinary offline derivation — so no hash here tracks kb's own code, and
# editing kb never needs a hash refresh. Only this host's slice of them is
# fetched (`host-bun-nix.nix`): the foreign-platform natives bun would skip
# anyway, e.g. the Agent SDK's per-platform CLI binaries, stay unfetched.
stdenvNoCC.mkDerivation {
  pname = "kb";
  # The version is package.json's, stated nowhere else.
  inherit (lib.importJSON ../package.json) version;

  src = lib.cleanSourceWith {
    src = ./..;
    filter =
      path: _type:
      !(builtins.elem (baseNameOf path) [
        "node_modules"
        "dist"
        "out"
        ".source-hash"
      ]);
  };

  nativeBuildInputs = [
    bun
    bun2nix.hook
    makeBinaryWrapper
  ];

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = callPackage ./host-bun-nix.nix { };
  };

  # The hook installs node_modules from bunDeps; building and installing are
  # kb's own two artifacts, below.
  dontUseBunBuild = true;
  dontUseBunCheck = true;
  dontUseBunInstall = true;

  buildPhase = ''
    runHook preBuild
    (cd packages/app/ui && bun run build)
    sh bin/build-cli "$TMPDIR/bundle"
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/kb/packages/app/ui" "$out/bin"
    cp -a "$TMPDIR/bundle/." "$out/lib/kb/"
    cp -a packages/app/ui/dist "$out/lib/kb/packages/app/ui/dist"
    cp bin/kb-bun "$out/lib/kb/launch"
    patchShebangs "$out/lib/kb/launch"
    cp packages/infrastructure/child-process/src/kb-launch-flags.txt "$out/lib/kb/launch-flags"
    makeBinaryWrapper "$out/lib/kb/launch" "$out/bin/kb" \
      --set KB_PKG_ROOT "$out/lib/kb" \
      --add-flags "${lib.getExe bun} $out/lib/kb/launch-flags $out/lib/kb/cli.js"
    runHook postInstall
  '';

  # The real installed binary joins the same startup contract as checkout/release.
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    export KB_HOME="$TMPDIR/kb-startup-home"
    export KB_DATA="$TMPDIR/kb-startup-data"
    export KB_NIX_TEST_BIN="$out/bin/kb"
    bun test packages/app/cli/tests/startup-contract.test.ts --timeout 30000
    runHook postInstallCheck
  '';

  meta = {
    description = "Repo-native outliner datastore (CLI + browser UI)";
    license = lib.licenses.mit;
    mainProgram = "kb";
    platforms = lib.platforms.darwin ++ lib.platforms.linux;
  };
}
