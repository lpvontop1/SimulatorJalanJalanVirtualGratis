# Aturan proguard (minify dinonaktifkan, jadi ini hanya formalitas)
-keep class gg.zdn.simulatorjalanjalan.** { *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
