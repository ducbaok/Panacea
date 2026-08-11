plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.apollo)
    alias(libs.plugins.hilt)
    alias(libs.plugins.kotlin.serialization)
    id("kotlin-kapt")
}

android {
    namespace = "com.antigravity"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.antigravity"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }

        buildConfigField("String", "BASE_URL", "\"https://api.antigravity.app/graphql\"")
        buildConfigField("String", "WS_URL", "\"wss://api.antigravity.app/graphql\"")
        buildConfigField("String", "REST_BASE_URL", "\"https://api.antigravity.app/\"")
    }

    buildTypes {
        debug {
            isDebuggable = true
            buildConfigField("String", "BASE_URL", "\"http://10.0.2.2:4000/graphql\"")
            buildConfigField("String", "WS_URL", "\"ws://10.0.2.2:4000/graphql\"")
            buildConfigField("String", "REST_BASE_URL", "\"http://10.0.2.2:4000/\"")
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

apollo {
    service("antigravity") {
        packageName.set("com.antigravity.graphql")
        schemaFile.set(file("src/main/graphql/schema.graphqls"))
        srcDir("src/main/graphql")
        generateKotlinModels.set(true)
    }
}

dependencies {
    // Compose BOM
    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.activity)
    implementation(libs.compose.navigation)
    implementation(libs.compose.hilt.navigation)
    implementation(libs.compose.paging)
    debugImplementation(libs.compose.ui.tooling)

    // Core
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.lifecycle.viewmodel)

    // Apollo Kotlin (GraphQL)
    implementation(libs.apollo.runtime)
    implementation(libs.apollo.cache)
    implementation(libs.apollo.adapters)

    // Hilt
    implementation(libs.hilt.android)
    kapt(libs.hilt.compiler)

    // Paging 3
    implementation(libs.paging.runtime)

    // DataStore
    implementation(libs.datastore)

    // Network
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)

    // Kotlin
    implementation(libs.kotlin.serialization)
    implementation(libs.kotlin.coroutines)

    // Image loading
    implementation(libs.coil)

    // Firebase
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    // Security
    implementation(libs.security.crypto)
}
