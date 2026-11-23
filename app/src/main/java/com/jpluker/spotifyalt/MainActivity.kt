package com.jpluker.spotifyalt

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.mozilla.geckoview.GeckoView

class MainActivity : AppCompatActivity() {
    companion object {
        const val ACTION_SETTINGS = "com.jpluker.spotifyalt.SETTINGS"
    }

    private lateinit var view: GeckoView

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) android.util.Log.i("SpotifyAlt", "Notifications off: no media card in the shade")
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Debug builds only: the emulator test can try Spotify's phone site (see emulator-smoke.sh).
        if (BuildConfig.DEBUG) PlayerSession.debugMobileSite = intent?.getBooleanExtra("debug_mobile_site", false) == true

        view = GeckoView(this)
        // Android 15+ draws apps under the status and navigation bars. Keep the page clear of
        // them (and of camera cutouts); the canvas color shows behind the bars.
        val frame = FrameLayout(this)
        frame.addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        ViewCompat.setOnApplyWindowInsetsListener(frame) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(frame)
        view.setSession(PlayerSession.session(this))
        PlayerSession.onSessionReplaced = { session ->
            view.releaseSession()
            view.setSession(session)
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // At the start page, go to the background instead of closing, so music keeps playing.
                if (PlayerSession.canGoBack) PlayerSession.goBack() else moveTaskToBack(true)
            }
        })

        handleIntent(intent)

        if (Build.VERSION.SDK_INT >= 33) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        when (intent?.action) {
            ACTION_SETTINGS -> PlayerSession.command("open-settings")
            Intent.ACTION_VIEW -> UrlPolicy.playerUrlFrom(intent.dataString)?.let(PlayerSession::loadUri)
        }
    }

    override fun onDestroy() {
        PlayerSession.onSessionReplaced = null
        view.releaseSession()
        super.onDestroy()
    }
}
