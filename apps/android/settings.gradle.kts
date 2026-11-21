// kb's Android app, a Capacitor shell: a Gradle project of its own, outside the Bun
// workspace (`packages/*/*`), built in `nix develop .#android` (README.md).
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "kb-capture"
include(":app")
