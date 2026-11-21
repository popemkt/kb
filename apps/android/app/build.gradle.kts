plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "app.kb.capture"
    // Held to the SDK `nix/android-shell.nix` composes: the store path is
    // read-only, so AGP cannot fetch a platform or build-tools it lacks.
    compileSdk = 36
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "app.kb.capture"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.2.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        unitTests.isIncludeAndroidResources = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

/**
 * kb's design system, as the web UI defines it, put beside the shell's page
 * (`assets/public/design-system.css`) at build time: the shell styles itself
 * with the UI's own custom properties and keeps no copy of them.
 */
abstract class KbDesignSystem : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val source: RegularFileProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val target = outputDir.get().asFile.resolve("public")
        target.mkdirs()
        source.get().asFile.copyTo(target.resolve("design-system.css"), overwrite = true)
    }
}

val kbDesignSystem =
    tasks.register<KbDesignSystem>("kbDesignSystem") {
        source.set(rootProject.layout.projectDirectory.file("../../packages/app/ui/src/design-system.css"))
    }

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(kbDesignSystem, KbDesignSystem::outputDir)
    }
}

dependencies {
    implementation(libs.capacitor.core)
    implementation(libs.androidx.core)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity)
    implementation(libs.lifecycle.runtime)
    implementation(libs.work.runtime)
    implementation(libs.serialization.json)
    implementation(libs.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.robolectric)
    testImplementation(libs.work.testing)
}
