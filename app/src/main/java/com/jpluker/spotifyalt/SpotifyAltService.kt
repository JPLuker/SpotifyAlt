package com.jpluker.spotifyalt

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import org.json.JSONObject
import java.net.URL
import kotlin.concurrent.thread

class SpotifyAltService : Service() {
    companion object {
        const val ACTION_START = "com.jpluker.spotifyalt.START"
        const val ACTION_UPDATE = "com.jpluker.spotifyalt.UPDATE"
        const val EXTRA_STATE = "media_state"

        private const val CHANNEL_ID = "spotifyalt_media"
        private const val NOTIFICATION_ID = 1701
        private const val ACTION_PREVIOUS = "com.jpluker.spotifyalt.PREVIOUS"
        private const val ACTION_TOGGLE = "com.jpluker.spotifyalt.TOGGLE"
        private const val ACTION_NEXT = "com.jpluker.spotifyalt.NEXT"
        private const val ACTION_HEART = "com.jpluker.spotifyalt.HEART"
    }

    private lateinit var session: MediaSessionCompat
    private val handler = Handler(Looper.getMainLooper())

    @Volatile private var title = "SpotifyAlt"
    @Volatile private var artist = "Waiting for web player"
    @Volatile private var trackUri: String? = null
    @Volatile private var artUrl: String? = null
    @Volatile private var artwork: Bitmap? = null
    @Volatile private var liked = false
    @Volatile private var playing = false
    @Volatile private var positionMs = 0L
    @Volatile private var durationMs = 0L

    override fun onCreate() {
        super.onCreate()
        createChannel()

        session = MediaSessionCompat(this, "SpotifyAltWebPlayer").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = sendToWeb("play")
                override fun onPause() = sendToWeb("pause")
                override fun onSkipToNext() = sendToWeb("next")
                override fun onSkipToPrevious() = sendToWeb("previous")
                override fun onSeekTo(pos: Long) = sendToWeb("seek:$pos")
                override fun onCustomAction(action: String?, extras: android.os.Bundle?) {
                    if (action == ACTION_HEART) toggleHeart()
                }
            })
            setSessionActivity(contentIntent())
            isActive = true
        }

        publishState()
        startForeground(NOTIFICATION_ID, buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPDATE -> intent.getStringExtra(EXTRA_STATE)?.let(::applyWebState)
            ACTION_PREVIOUS -> sendToWeb("previous")
            ACTION_TOGGLE -> sendToWeb(if (playing) "pause" else "play")
            ACTION_NEXT -> sendToWeb("next")
            ACTION_HEART -> toggleHeart()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        session.isActive = false
        session.release()
        super.onDestroy()
    }

    private fun applyWebState(raw: String) {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return
        title = json.optString("title", title).ifBlank { "SpotifyAlt" }
        artist = json.optString("artist", artist).ifBlank { "Unknown artist" }
        trackUri = json.optString("uri").takeIf { it.startsWith("spotify:track:") }
        liked = json.optBoolean("liked", liked)
        playing = json.optBoolean("playing", false)
        positionMs = json.optLong("positionMs", 0L).coerceAtLeast(0L)
        durationMs = json.optLong("durationMs", 0L).coerceAtLeast(0L)

        val newArtUrl = json.optString("artUrl").takeIf { it.startsWith("https://") }
        if (newArtUrl != artUrl) {
            artUrl = newArtUrl
            artwork = null
            if (newArtUrl != null) loadArtwork(newArtUrl)
        }

        publishState()
        updateNotification()
    }

    private fun sendToWeb(command: String) {
        WebRuntimeBridge.send(command)
    }

    private fun toggleHeart() {
        val uri = trackUri ?: return
        val target = !liked
        thread(name = "spotifyalt-heart") {
            val changed = runCatching { SpotifyApi.setSaved(this, uri, target) }.getOrDefault(false)
            if (!changed) return@thread

            liked = target
            WebRuntimeBridge.send("liked:$target")
            handler.post {
                publishState()
                updateNotification()
            }
        }
    }

    private fun publishState() {
        val actions =
            PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SEEK_TO

        val heartAction = PlaybackStateCompat.CustomAction.Builder(
            ACTION_HEART,
            if (liked) "Remove from Liked Songs" else "Add to Liked Songs",
            if (liked) R.drawable.ic_heart else R.drawable.ic_heart_outline
        ).build()

        session.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_URI, trackUri)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
                .apply {
                    artwork?.let { putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) }
                }
                .build()
        )

        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(actions)
                .addCustomAction(heartAction)
                .setState(
                    if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                    positionMs,
                    if (playing) 1f else 0f,
                    SystemClock.elapsedRealtime()
                )
                .build()
        )
    }

    private fun updateNotification() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun buildNotification() = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_media_play)
        .setContentIntent(contentIntent())
        .setContentTitle(title)
        .setContentText(artist)
        .setLargeIcon(artwork)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setOngoing(playing)
        .addAction(
            if (liked) R.drawable.ic_heart else R.drawable.ic_heart_outline,
            if (liked) "Unlike" else "Like",
            action(ACTION_HEART, 4)
        )
        .addAction(android.R.drawable.ic_media_previous, "Previous", action(ACTION_PREVIOUS, 1))
        .addAction(
            if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
            if (playing) "Pause" else "Play",
            action(ACTION_TOGGLE, 2)
        )
        .addAction(android.R.drawable.ic_media_next, "Next", action(ACTION_NEXT, 3))
        .setStyle(
            MediaStyle()
                .setMediaSession(session.sessionToken)
                .setShowActionsInCompactView(0, 2, 3)
        )
        .build()

    private fun action(action: String, requestCode: Int): PendingIntent =
        PendingIntent.getService(
            this,
            requestCode,
            Intent(this, SpotifyAltService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    private fun contentIntent(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun loadArtwork(url: String) {
        thread(name = "spotifyalt-artwork") {
            val bitmap = runCatching {
                URL(url).openStream().use(BitmapFactory::decodeStream)
            }.getOrNull() ?: return@thread

            if (artUrl != url) return@thread
            artwork = bitmap
            handler.post {
                publishState()
                updateNotification()
            }
        }
    }

    private fun createChannel() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "SpotifyAlt media controls",
                NotificationManager.IMPORTANCE_LOW
            )
        )
    }
}
