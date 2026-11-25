plugins {
    id("com.android.application") version "8.10.1"
    id("org.jetbrains.kotlin.android") version "2.0.21"
}

android {
    namespace = "app.onelife.daybook"
    compileSdk = 36
    defaultConfig {
        applicationId = "app.onelife.daybook"
        minSdk = 28
        targetSdk = 35
        versionCode = 82
        versionName = "0.40.2"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/oneLifeAssets"))
}

val syncWebAssets by tasks.registering(Sync::class) {
    from(rootProject.file("../dist"))
    exclude("*.apk", "sw.js")
    into(layout.buildDirectory.dir("generated/oneLifeAssets"))
}
tasks.named("preBuild").configure { dependsOn(syncWebAssets) }

dependencies {
    testImplementation("junit:junit:4.13.2")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.android.gms:play-services-auth:21.4.0")
}
