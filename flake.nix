{
  description = "kb: a repo-native outliner datastore (CLI + browser UI)";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    # Keep in step with the `bun2nix` catalog entry in package.json: the CLI
    # writes bun.nix and this input reads it, and the `bun-nix-current`
    # harness holds the two to one release.
    bun2nix = {
      url = "github:nix-community/bun2nix/2.1.2";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      bun2nix,
    }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      # EXPERIMENT (docs/research/2026-10-31-rust-wasm-in-kb.md): the
      # toolchain the datom kernel's Rust crate builds with. Not part of the
      # default shell, so nothing kb runs today pays for it. The crate pins
      # `wasm-bindgen` to this nixpkgs' `wasm-bindgen-cli` exactly.
      wasmShell =
        pkgs:
        pkgs.mkShell {
          packages = with pkgs; [
            binaryen
            cargo
            # nixpkgs' rustc links wasm32 with `lld` from PATH, not a bundled rust-lld.
            lld
            rustc
            wasm-bindgen-cli
          ];
        };
    in
    {
      packages = forAllSystems (pkgs: {
        kb = pkgs.callPackage ./nix/package.nix {
          bun2nix = bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.kb;
      });

      checks = forAllSystems (pkgs: {
        inherit (self.packages.${pkgs.stdenv.hostPlatform.system}) kb;
      });

      devShells = forAllSystems (pkgs: {
        # `bun` is the one kb runs on everywhere: this shell (so the
        # pre-commit hook), CI, and `packages.kb`'s build. The rest is what
        # the hook and CI call that node_modules does not carry.
        default = pkgs.mkShell {
          packages = with pkgs; [
            actionlint
            bun
            curl
            git
            jq
            nixfmt
            shellcheck
          ];
        };
        wasm = wasmShell pkgs;
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
