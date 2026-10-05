package gg.zdn.simulatorjalanjalan

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader

/**
 * Simulator Jalan Jalan Virtual
 * Pembungkus Kotlin untuk WebView fullscreen (immersive, landscape).
 * Seluruh antarmuka & logika game berada di assets/www (HTML/CSS/JS).
 *
 * Kredit: zdn_gg
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var netCallback: ConnectivityManager.NetworkCallback? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Layar selalu menyala saat bermain
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this)
        setContentView(webView)

        setupImmersive()

        // ---- WebViewAssetLoader: sajikan assets lewat origin https aman ----
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            mediaPlaybackRequiresUserGesture = false
            allowContentAccess = false
            allowFileAccess = false
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        }
        webView.setBackgroundColor(0xFF0D1B2A.toInt())
        webView.overScrollMode = View.OVER_SCROLL_NEVER

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                // semua navigasi tetap di dalam WebView (origin appassets)
                val host = request.url.host ?: return true
                return host != "appassets.androidplatform.net"
            }
        }

        // ---- Jembatan JS <-> Android ----
        webView.addJavascriptInterface(Bridge(), "AndroidBridge")

        // ---- Tombol kembali fisik -> dikirim ke JS ----
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.__androidBack && window.__androidBack()", null)
            }
        })

        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")

        // ---- Pantau koneksi -> beri tahu JS ----
        watchConnectivity()
    }

    private fun setupImmersive() {
        window.setDecorFitsSystemWindows(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let { ctrl ->
                ctrl.hide(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars())
                ctrl.systemBarsBehavior =
                    android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) setupImmersive()
    }

    /** Panggilan balik dari JS: sembunyikan lagi bilah sistem (mis. setelah popup) */
    private inner class Bridge {
        @android.webkit.JavascriptInterface
        fun minimize() {
            runOnUiThread { moveTaskToBack(true) }
        }

        @android.webkit.JavascriptInterface
        fun notifyReady() {
            runOnUiThread { setupImmersive() }
        }
    }

    private fun isOnline(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val net = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(net) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun watchConnectivity() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread {
                    webView.evaluateJavascript("window.__setOnline && window.__setOnline(true)", null)
                }
            }

            override fun onLost(network: Network) {
                runOnUiThread {
                    webView.evaluateJavascript(
                        "window.__setOnline && window.__setOnline(" + isOnline() + ")",
                        null
                    )
                }
            }
        }
        netCallback = callback
        cm.registerNetworkCallback(request, callback)
        // status awal
        webView.evaluateJavascript("window.__setOnline && window.__setOnline(${isOnline()})", null)
    }

    override fun onDestroy() {
        netCallback?.let { netCallback ->
            (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager)
                .unregisterNetworkCallback(netCallback)
        }
        webView.destroy()
        super.onDestroy()
    }
}
