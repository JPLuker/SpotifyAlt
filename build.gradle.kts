plugins {
    // AGP 9 compiles Kotlin itself (no separate kotlin-android plugin applied).
    id("com.android.application") version "9.1.1" apply false
    // Not applied: only sets the Kotlin compiler version AGP uses. GeckoView 160 pulls in
    // kotlin-stdlib 2.4, which AGP's bundled 2.2 compiler can't read.
    id("org.jetbrains.kotlin.android") version "2.4.21" apply false
}
