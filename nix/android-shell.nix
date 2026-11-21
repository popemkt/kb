# The toolchains `apps/android` builds and runs with: a JDK (21, which
# Capacitor 8 needs), Gradle and an Android SDK composed from nixpkgs'
# androidenv, so nothing is installed on the host. Two shells over one
# composition:
#
# - `android` builds the APK and runs its JVM unit tests (Validate's
#   `android` job);
# - `android-emulator` adds the emulator and one system image of the same
#   platform, to run the APK headless, and what `bin/android-smoke` drives
#   a scratch kb store with (Bun, curl, jq).
#
# The SDK is unfree and needs its licence accepted; the flake imports nixpkgs
# for these shells alone with that config, so the default shell and the kb
# package stay free. The versions here are the ones `apps/android` names
# (`compileSdk`, `buildToolsVersion`); change them together.
{
  stdenv,
  mkShell,
  androidenv,
  gradle_8,
  jdk21,
  bun,
  curl,
  jq,
}:
let
  buildTools = "35.0.0";
  platform = "36";
  # One shell: the SDK composition's components beyond the build's, and
  # the tools beside the SDK.
  shell =
    {
      components ? { },
      tools ? [ ],
    }:
    let
      android = androidenv.composeAndroidPackages (
        {
          platformVersions = [ platform ];
          buildToolsVersions = [ buildTools ];
          includeEmulator = false;
          includeSystemImages = false;
          includeNDK = false;
        }
        // components
      );
      sdk = "${android.androidsdk}/libexec/android-sdk";
    in
    mkShell {
      packages = [
        android.androidsdk
        android.platform-tools
        gradle_8
        jdk21
      ]
      ++ tools;
      ANDROID_HOME = sdk;
      ANDROID_SDK_ROOT = sdk;
      JAVA_HOME = jdk21.home;
      # AGP fetches aapt2 from Maven as a dynamically linked binary, which does
      # not run on NixOS; point it at the SDK's own, which nixpkgs has patched.
      GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${sdk}/build-tools/${buildTools}/aapt2";
    };
in
{
  android = shell { };
  # AOSP's own image (no Google services: the app needs none), in the host's
  # architecture so the emulator runs it on KVM or Hypervisor.framework.
  android-emulator = shell {
    components = {
      includeEmulator = true;
      includeSystemImages = true;
      systemImageTypes = [ "default" ];
      abiVersions = [ (if stdenv.hostPlatform.isAarch64 then "arm64-v8a" else "x86_64") ];
    };
    tools = [
      bun
      curl
      jq
    ];
  };
}
