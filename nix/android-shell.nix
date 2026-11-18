# The toolchain `apps/android` builds with: a JDK, Gradle and an Android SDK
# composed from nixpkgs' androidenv, so nothing is installed on the host.
#
# The SDK is unfree and needs its licence accepted; the flake imports nixpkgs
# for this shell alone with that config, so the default shell and the kb
# package stay free. The versions here are the ones `apps/android` names
# (`compileSdk`, `buildToolsVersion`); change them together.
{
  mkShell,
  androidenv,
  gradle_8,
  jdk17,
}:
let
  buildTools = "35.0.0";
  android = androidenv.composeAndroidPackages {
    platformVersions = [ "36" ];
    buildToolsVersions = [ buildTools ];
    includeEmulator = false;
    includeSystemImages = false;
    includeNDK = false;
  };
  sdk = "${android.androidsdk}/libexec/android-sdk";
in
mkShell {
  packages = [
    android.androidsdk
    android.platform-tools
    gradle_8
    jdk17
  ];
  ANDROID_HOME = sdk;
  ANDROID_SDK_ROOT = sdk;
  JAVA_HOME = jdk17.home;
  # AGP fetches aapt2 from Maven as a dynamically linked binary, which does
  # not run on NixOS; point it at the SDK's own, which nixpkgs has patched.
  GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${sdk}/build-tools/${buildTools}/aapt2";
}
