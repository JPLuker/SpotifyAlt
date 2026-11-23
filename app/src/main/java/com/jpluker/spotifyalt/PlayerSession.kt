package com.jpluker.spotifyalt

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONObject
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSession.PermissionDelegate.ContentPermission
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.MediaSession
import org.mozilla.geckoview.WebExtension
import java.io.File

/**
 * The one player: a GeckoView session on open.spotify.com with the Heartline extension built in.
 * Lives for the whole process so playback survives the activity going away (rotation, back,
 * switching apps). The activity only attaches a view to it.
 */
object PlayerSession {
    private const val TAG = "SpotifyAlt"
    const val START_URL = "https://open.spotify.com/"
    private const val EXTENSION_ID = "heartline@jpluker.com"
    private const val EXTENSION_URI = "resource://android/assets/heartline/"
    private const val NATIVE_APP = "heartline"

    private lateinit var appContext: Context
    private var runtime: GeckoRuntime? = null
    private var session: GeckoSession? = null
    private var port: WebExtension.Port? = null
    private var media: MediaSession? = null
    private val listeners = mutableSetOf<(PlayerState) -> Unit>()

    var state = PlayerState()
        private set

    /** Where the heart support is at, for logs and diagnostics. */
    var extensionStatus = "not started"
        private set

    var canGoBack = false
        private set

    /** Called when a crashed page process forces a new session; the activity re-attaches. */
    var onSessionReplaced: ((GeckoSession) -> Unit)? = null

    fun session(context: Context): GeckoSession {
        session?.let { return it }
        appContext = context.applicationContext
        val rt = runtime(appContext)
        val s = GeckoSession(
            GeckoSessionSettings.Builder()
                // Spotify's mobile site sends people to its app; the desktop player works in Firefox.
                .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
                .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_MOBILE)
                .build()
        )
        s.navigationDelegate = navigation
        s.permissionDelegate = permissions
        s.contentDelegate = content
        s.mediaSessionDelegate = mediaDelegate
        s.open(rt)
        session = s

        extensionStatus = "installing"
        rt.webExtensionController.ensureBuiltIn(EXTENSION_URI, EXTENSION_ID).accept(
            { ext ->
                if (ext != null) {
                    s.webExtensionController.setMessageDelegate(ext, messages, NATIVE_APP)
                    extensionStatus = "installed"
                } else {
                    extensionStatus = "missing"
                    Log.e(TAG, "Heartline extension did not install (no extension returned)")
                }
                s.loadUri(START_URL)
            },
            { err ->
                // The player still works without hearts; say so in the log rather than failing.
                extensionStatus = "failed: ${err?.message}"
                Log.e(TAG, "Heartline extension failed to install", err)
                s.loadUri(START_URL)
            },
        )
        return s
    }

    private fun runtime(context: Context): GeckoRuntime {
        runtime?.let { return it }
        val config = File(context.filesDir, "geckoview-config.yaml")
        config.writeText(
            """
            prefs:
              media.eme.enabled: true
              media.mediadrm-widevinecdm.visible: true
              dom.media.mediasession.enabled: true
            """.trimIndent() + "\n"
        )
        val settings = GeckoRuntimeSettings.Builder()
            .configFilePath(config.absolutePath)
            .consoleOutput(BuildConfig.DEBUG)
            .remoteDebuggingEnabled(BuildConfig.DEBUG)
            .build()
        return GeckoRuntime.create(context, settings).also { runtime = it }
    }

    fun loadUri(url: String) {
        if (UrlPolicy.isPlayer(url)) session?.loadUri(url)
    }

    fun goBack() {
        session?.goBack()
    }

    // ------------------------------------------------------------------ state

    fun addListener(listener: (PlayerState) -> Unit) {
        listeners += listener
        listener(state)
    }

    fun removeListener(listener: (PlayerState) -> Unit) {
        listeners -= listener
    }

    private fun update(change: (PlayerState) -> PlayerState) {
        val next = change(state)
        if (next == state) return
        state = next
        listeners.toList().forEach { it(next) }
    }

    // --------------------------------------------------------------- commands

    /**
     * play, pause, toggle, next, previous, seek:<ms>, like, open-settings.
     * Transport goes through GeckoView's media session (what Spotify registered); when there
     * isn't one yet, the extension presses Spotify's own buttons.
     */
    fun command(command: String) {
        val m = media
        when {
            command == "play" && m != null -> m.play()
            command == "pause" && m != null -> m.pause()
            command == "toggle" && m != null -> if (state.playing) m.pause() else m.play()
            command == "next" && m != null -> m.nextTrack()
            command == "previous" && m != null -> m.previousTrack()
            command.startsWith("seek:") -> {
                val ms = command.removePrefix("seek:").toLongOrNull() ?: return
                m?.seekTo(ms / 1000.0, false)
            }
            command == "play" || command == "pause" || command == "toggle" -> sendToPage("playpause")
            command == "next" || command == "previous" || command == "like" || command == "open-settings" ->
                sendToPage(command)
            else -> Log.w(TAG, "Unknown command: $command")
        }
    }

    private fun sendToPage(command: String) {
        val p = port
        if (p == null) {
            Log.w(TAG, "Page bridge not connected ($extensionStatus); dropped command $command")
            return
        }
        p.postMessage(JSONObject().put("command", command))
    }

    private fun startMediaService() {
        if (SpotifyAltService.running) return
        try {
            ContextCompat.startForegroundService(appContext, Intent(appContext, SpotifyAltService::class.java))
        } catch (err: IllegalStateException) {
            // Android won't start a foreground service from the background; the next play
            // while the app is open starts it.
            Log.w(TAG, "Media controls not started from the background", err)
        }
    }

    private fun openExternal(url: String) {
        try {
            appContext.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (err: Exception) {
            Log.w(TAG, "No app to open $url", err)
        }
    }

    private fun replaceSession() {
        runCatching { session?.close() }.onFailure { Log.w(TAG, "Closing the dead session failed", it) }
        session = null
        port = null
        media = null
        update { it.copy(playing = false) }
        onSessionReplaced?.invoke(session(appContext))
    }

    // -------------------------------------------------------------- delegates

    private val navigation = object : GeckoSession.NavigationDelegate {
        override fun onLoadRequest(
            session: GeckoSession,
            request: GeckoSession.NavigationDelegate.LoadRequest,
        ): GeckoResult<AllowOrDeny>? = when (UrlPolicy.decide(request.uri)) {
            UrlPolicy.Decision.LOAD -> GeckoResult.allow()
            UrlPolicy.Decision.EXTERNAL -> {
                openExternal(request.uri)
                GeckoResult.deny()
            }
            UrlPolicy.Decision.BLOCK -> GeckoResult.deny()
        }

        override fun onNewSession(session: GeckoSession, uri: String): GeckoResult<GeckoSession>? {
            // One window only: allowed pages open in place, the rest in the browser.
            when (UrlPolicy.decide(uri)) {
                UrlPolicy.Decision.LOAD -> session.loadUri(uri)
                UrlPolicy.Decision.EXTERNAL -> openExternal(uri)
                UrlPolicy.Decision.BLOCK -> Unit
            }
            return null
        }

        override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) {
            this@PlayerSession.canGoBack = canGoBack
        }
    }

    private val permissions = object : GeckoSession.PermissionDelegate {
        override fun onContentPermissionRequest(
            session: GeckoSession,
            perm: ContentPermission,
        ): GeckoResult<Int>? {
            val wanted = perm.permission == GeckoSession.PermissionDelegate.PERMISSION_MEDIA_KEY_SYSTEM_ACCESS ||
                perm.permission == GeckoSession.PermissionDelegate.PERMISSION_AUTOPLAY_AUDIBLE ||
                perm.permission == GeckoSession.PermissionDelegate.PERMISSION_AUTOPLAY_INAUDIBLE
            val allow = wanted && UrlPolicy.isPlayer(perm.uri)
            return GeckoResult.fromValue(if (allow) ContentPermission.VALUE_ALLOW else ContentPermission.VALUE_DENY)
        }
    }

    private val content = object : GeckoSession.ContentDelegate {
        override fun onCrash(session: GeckoSession) {
            Log.e(TAG, "Page process crashed; starting a new session")
            replaceSession()
        }

        override fun onKill(session: GeckoSession) {
            Log.w(TAG, "Page process was killed; starting a new session")
            replaceSession()
        }
    }

    private val mediaDelegate = object : MediaSession.Delegate {
        override fun onActivated(session: GeckoSession, mediaSession: MediaSession) {
            media = mediaSession
        }

        override fun onDeactivated(session: GeckoSession, mediaSession: MediaSession) {
            if (media === mediaSession) media = null
        }

        override fun onMetadata(session: GeckoSession, mediaSession: MediaSession, meta: MediaSession.Metadata) {
            update {
                it.copy(
                    title = meta.title ?: it.title,
                    artist = meta.artist ?: it.artist,
                    album = meta.album ?: it.album,
                )
            }
        }

        override fun onPlay(session: GeckoSession, mediaSession: MediaSession) {
            update { it.copy(playing = true) }
            startMediaService()
        }

        override fun onPause(session: GeckoSession, mediaSession: MediaSession) {
            update { it.copy(playing = false) }
        }

        override fun onStop(session: GeckoSession, mediaSession: MediaSession) {
            update { it.copy(playing = false) }
        }

        override fun onPositionState(
            session: GeckoSession,
            mediaSession: MediaSession,
            positionState: MediaSession.PositionState,
        ) {
            update {
                it.copy(
                    positionMs = (positionState.position * 1000).toLong().coerceAtLeast(0L),
                    durationMs = (positionState.duration * 1000).toLong().coerceAtLeast(0L),
                )
            }
        }
    }

    private val messages = object : WebExtension.MessageDelegate {
        override fun onConnect(port: WebExtension.Port) {
            this@PlayerSession.port = port
            extensionStatus = "connected"
            port.setDelegate(portDelegate)
        }
    }

    private val portDelegate = object : WebExtension.PortDelegate {
        override fun onPortMessage(message: Any, port: WebExtension.Port) {
            val json = message as? JSONObject ?: return
            when (json.optString("type")) {
                "state" -> json.optJSONObject("state")?.let { s ->
                    update { PlayerState.fromExtension(s, it) }
                    if (state.playing) startMediaService()
                }
                "hello" -> Log.i(TAG, "Heartline connected")
                "diag" -> json.optJSONObject("diag")?.let { d ->
                    Log.i(
                        TAG,
                        "Heartline diag: widevine=${d.optBoolean("widevine")} " +
                            "keySystem=${d.optString("keySystem").take(40)} error=${d.optString("error").take(120)}",
                    )
                }
            }
        }

        override fun onDisconnect(port: WebExtension.Port) {
            if (this@PlayerSession.port === port) this@PlayerSession.port = null
        }
    }
}
