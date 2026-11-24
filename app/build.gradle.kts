import groovy.json.JsonOutput
import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
}

// GeckoView release (Firefox's engine). Pinned; bump on purpose (CLAUDE.md).
val geckoviewVersion = providers.gradleProperty("geckoviewVersion").getOrElse("latest.release")
// arm64-v8a for phones. CI's emulator test builds x86_64 with -PgeckoAbi=x86_64.
val geckoAbi = providers.gradleProperty("geckoAbi").getOrElse("arm64-v8a")

android {
    namespace = "com.jpluker.spotifyalt"
    // GeckoView 160 is built against API 37 and requires it.
    compileSdk = 37

    defaultConfig {
        applicationId = "com.jpluker.spotifyalt"
        minSdk = 26
        targetSdk = 35
        versionCode = 12
        versionName = "0.3.8"
        ndk { abiFilters += geckoAbi }
    }

    // Release signing comes only from CI secrets made by app/scripts/setup-signing.sh.
    // No fallback key: without them there's no signed release (SECURITY-BASELINE 4).
    val keystorePath = System.getenv("SPOTIFYALT_KEYSTORE_FILE")
    signingConfigs {
        create("release") {
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storeType = "PKCS12"
                storePassword = System.getenv("SPOTIFYALT_STORE_PASSWORD")
                keyAlias = System.getenv("SPOTIFYALT_KEY_ALIAS")
                keyPassword = System.getenv("SPOTIFYALT_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else null
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

// The page script is shared with the desktop app (repo-root extension/). Copy it in and
// write the Android manifest from the shared one, so version and matches have one source.
abstract class HeartlineAssetsTask : DefaultTask() {
    @get:InputDirectory
    abstract val sharedDir: DirectoryProperty

    @get:InputDirectory
    abstract val androidDir: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun run() {
        val root = outputDir.get().asFile
        root.deleteRecursively()
        val dest = root.resolve("heartline").apply { mkdirs() }
        val shared = sharedDir.get().asFile
        val android = androidDir.get().asFile
        listOf("heartline.js", "heartline.css").forEach { shared.resolve(it).copyTo(dest.resolve(it), overwrite = true) }
        listOf("android-flag.js", "android-bridge.js").forEach { android.resolve(it).copyTo(dest.resolve(it), overwrite = true) }
        @Suppress("UNCHECKED_CAST")
        val base = JsonSlurper().parse(shared.resolve("manifest.json")) as MutableMap<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val overlay = JsonSlurper().parse(android.resolve("manifest.overlay.json")) as Map<String, Any?>
        base.remove("minimum_chrome_version")
        base.putAll(overlay)
        dest.resolve("manifest.json").writeText(JsonOutput.prettyPrint(JsonOutput.toJson(base)))
    }
}

val heartlineAssets = tasks.register<HeartlineAssetsTask>("heartlineAssets") {
    sharedDir.set(rootProject.layout.projectDirectory.dir("extension"))
    androidDir.set(layout.projectDirectory.dir("src/main/heartline-android"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(heartlineAssets, HeartlineAssetsTask::outputDir)
    }
}

dependencies {
    implementation("org.mozilla.geckoview:geckoview-$geckoAbi:$geckoviewVersion")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.media:media:1.7.0")
    implementation("com.google.android.material:material:1.12.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
