import groovy.json.JsonOutput
import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
}

// GeckoView release (Firefox's engine). Pinned; bump on purpose (CLAUDE.md).
val geckoviewVersion = providers.gradleProperty("geckoviewVersion").getOrElse("latest.release")

android {
    namespace = "com.jpluker.spotifyalt"
    // GeckoView 160 is built against API 37 and requires it.
    compileSdk = 37

    defaultConfig {
        applicationId = "com.jpluker.spotifyalt"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "0.3.0"
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/heartline-assets"))

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

// The page script is shared with the desktop app (repo-root extension/). Copy it in and
// write the Android manifest from the shared one, so version and matches have one source.
val heartlineAssets = tasks.register("heartlineAssets") {
    val shared = rootProject.layout.projectDirectory.dir("extension")
    val android = layout.projectDirectory.dir("src/main/heartline-android")
    val out = layout.buildDirectory.dir("generated/heartline-assets/heartline")
    inputs.dir(shared)
    inputs.dir(android)
    outputs.dir(out)
    doLast {
        val dest = out.get().asFile
        dest.deleteRecursively()
        dest.mkdirs()
        listOf("heartline.js", "heartline.css").forEach { name ->
            shared.file(name).asFile.copyTo(dest.resolve(name), overwrite = true)
        }
        listOf("android-flag.js", "android-bridge.js").forEach { name ->
            android.file(name).asFile.copyTo(dest.resolve(name), overwrite = true)
        }
        @Suppress("UNCHECKED_CAST")
        val base = JsonSlurper().parse(shared.file("manifest.json").asFile) as MutableMap<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val overlay = JsonSlurper().parse(android.file("manifest.overlay.json").asFile) as Map<String, Any?>
        base.remove("minimum_chrome_version")
        base.putAll(overlay)
        dest.resolve("manifest.json").writeText(JsonOutput.prettyPrint(JsonOutput.toJson(base)))
    }
}

tasks.named("preBuild") { dependsOn(heartlineAssets) }

dependencies {
    implementation("org.mozilla.geckoview:geckoview-arm64-v8a:$geckoviewVersion")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.media:media:1.7.0")
    implementation("com.google.android.material:material:1.12.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
