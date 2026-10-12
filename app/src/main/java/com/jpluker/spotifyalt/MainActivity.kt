package com.jpluker.spotifyalt

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this)
        setContentView(webView)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            databaseEnabled = true
            setSupportZoom(false)
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        val bridge = Bridge()
        webView.addJavascriptInterface(bridge, "SpotifyAltNative")
        // Compatibility alias while the web bundle is migrated.
        webView.addJavascriptInterface(bridge, "SpotifyAlt")

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val uri = request.url

                if (uri.host == "appassets.androidplatform.net") return false

                return when (uri.scheme) {
                    "spotify", "market" -> {
                        openExternal(uri)
                        true
                    }
                    "http", "https" -> {
                        openExternal(uri)
                        true
                    }
                    else -> false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        webView.loadUrl(APP_URL)

        if (Build.VERSION.SDK_INT >= 33) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onDestroy() {
        webView.removeJavascriptInterface("SpotifyAltNative")
        webView.removeJavascriptInterface("SpotifyAlt")
        webView.destroy()
        super.onDestroy()
    }

    private fun openExternal(uri: Uri) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }

    inner class Bridge {
        @JavascriptInterface
        fun runtime(): String = "android-web-shell/${BuildConfig.VERSION_NAME}"

        @JavascriptInterface
        fun saveClientId(clientId: String) {
            getSharedPreferences("spotifyalt", MODE_PRIVATE)
                .edit()
                .putString("client_id", clientId.trim())
                .apply()
        }

        @JavascriptInterface
        fun connectSpotify(clientId: String) {
            saveClientId(clientId)
            runOnUiThread {
                SpotifyAuth.start(this@MainActivity) { message ->
                    webView.post {
                        webView.evaluateJavascript(
                            "window.SpotifyAltApp?.setStatus(${quoteJs(message)})",
                            null
                        )
                    }
                }
            }
        }

        @JavascriptInterface
        fun openNotificationAccess() {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }

        @JavascriptInterface
        fun startCompanion() {
            ContextCompat.startForegroundService(
                this@MainActivity,
                Intent(this@MainActivity, SpotifyAltService::class.java)
            )
        }

        @JavascriptInterface
        fun openUrl(url: String) {
            runCatching { Uri.parse(url) }
                .getOrNull()
                ?.let { uri -> runOnUiThread { openExternal(uri) } }
        }

        @JavascriptInterface
        fun status(): String {
            val prefs = getSharedPreferences("spotifyalt", MODE_PRIVATE)
            return if (prefs.contains("refresh_token")) {
                "Spotify connected"
            } else {
                "Spotify not connected"
            }
        }
    }

    private fun quoteJs(value: String): String =
        "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    companion object {
        private const val APP_URL =
            "https://appassets.androidplatform.net/assets/index.html"
    }
}
