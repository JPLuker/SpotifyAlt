package com.jpluker.spotifyalt

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.addJavascriptInterface(Bridge(), "SpotifyAlt")
        webView.loadUrl("file:///android_asset/index.html")

        if (Build.VERSION.SDK_INT >= 33) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    inner class Bridge {
        @JavascriptInterface fun saveClientId(clientId: String) {
            getSharedPreferences("spotifyalt", MODE_PRIVATE).edit().putString("client_id", clientId.trim()).apply()
        }

        @JavascriptInterface fun connectSpotify(clientId: String) {
            saveClientId(clientId)
            runOnUiThread {
                SpotifyAuth.start(this@MainActivity) { message ->
                    webView.post { webView.evaluateJavascript("window.setStatus(${quoteJs(message)})", null) }
                }
            }
        }

        @JavascriptInterface fun openNotificationAccess() {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }

        @JavascriptInterface fun startCompanion() {
            ContextCompat.startForegroundService(this@MainActivity, Intent(this@MainActivity, SpotifyAltService::class.java))
        }

        @JavascriptInterface fun status(): String {
            val prefs = getSharedPreferences("spotifyalt", MODE_PRIVATE)
            return if (prefs.contains("refresh_token")) "Spotify connected" else "Spotify not connected"
        }
    }

    private fun quoteJs(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}
