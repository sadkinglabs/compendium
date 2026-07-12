# ============================================================================
# Compendium R8 / shrinkResources keep rules (release build).
# The size win comes from stripping unused library code (Compose, CameraX, ML
# Kit) + unused resources. These rules keep everything reached by REFLECTION,
# which R8 can't see: the Capacitor bridge + plugins, the native card scanner,
# and the WebView JS interface. Conservative on purpose - verify on-device.
# ============================================================================

# Keep line numbers for readable release crash reports (maps the obfuscation).
-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# --- Capacitor core + bridge (plugins are found/invoked by reflection) ---
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.PluginMethod public <methods>;
}
# Cordova plugins bridged through Capacitor
-keep class org.apache.cordova.** { *; }

# --- The whole app package (small; keeps MainActivity + the reflection-
#     registered CardScannerPlugin + its Compose/CameraX/ML Kit scanner) ---
-keep class com.sadkinglabs.compendium.** { *; }

# --- ML Kit text recognition + barcode (bundled offline models) ---
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_** { *; }
-dontwarn com.google.mlkit.**

# --- @capacitor-community/sqlite (native JNI + reflection) ---
-keep class com.getcapacitor.community.database.sqlite.** { *; }
-keep class io.liteglue.** { *; }
-dontwarn io.liteglue.**
# SQLCipher: libsqlcipher.so's JNI_OnLoad resolves these Java classes by their
# ORIGINAL names via FindClass - R8 renaming/removing them aborts the native load
# at launch (register_android_database_SQLiteCompiledSql -> abort). Keep names + members.
-keep class net.sqlcipher.** { *; }
-keep interface net.sqlcipher.** { *; }
-dontwarn net.sqlcipher.**

# --- WebView JS bridge ---
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Kotlin metadata (reflection / coroutines)
-keep class kotlin.Metadata { *; }
-dontwarn kotlinx.**
