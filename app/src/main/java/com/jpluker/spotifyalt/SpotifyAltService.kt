package com.jpluker.spotifyalt

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
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
import androidx.core.app.ServiceCompat
import androidx.media.app.NotificationCompat.MediaStyle
import java.net.URL
import android.util.Log
import kotlin.concurrent.thread

class SpotifyAltService : Service() {
    companion object {
        /** True while the service exists; PlayerSession only starts it once. */
        @Volatile var running = false
            private set

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
    @Volatile private var artist = ""
    @Volatile private var trackUri: String? = null
    @Volatile private var artUrl: String? = null
    @Volatile private var artwork: Bitmap? = null
    @Volatile private var liked: Boolean? = null
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

        running = true
        publishState()
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(),
            if (android.os.Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0,
        )
        PlayerSession.addListener(stateListener)
    }

    private val stateListener: (PlayerState) -> Unit = { state -> handler.post { applyState(state) } }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PREVIOUS -> sendToWeb("previous")
            ACTION_TOGGLE -> sendToWeb("toggle")
            ACTION_NEXT -> sendToWeb("next")
            ACTION_HEART -> toggleHeart()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        running = false
        PlayerSession.removeListener(stateListener)
        session.isActive = false
        session.release()
        super.onDestroy()
    }

    private fun applyState(state: PlayerState) {
        title = state.title.ifBlank { "SpotifyAlt" }
        artist = state.artist
        trackUri = state.uri
        liked = state.liked
        playing = state.playing
        positionMs = state.positionMs
        durationMs = state.durationMs

        if (state.artworkUrl != artUrl) {
            artUrl = state.artworkUrl
            artwork = null
            state.artworkUrl?.let(::loadArtwork)
        }

        publishState()
        updateNotification()
    }

    private fun sendToWeb(command: String) {
        PlayerSession.command(command)
    }

    /** The extension does the save or unsave with Spotify, then reports the new state back. */
    private fun toggleHeart() {
        sendToWeb("like")
    }

    private fun publishState() {
        val actions =
            PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SEEK_TO

        val isLiked = liked == true
        val heartAction = PlaybackStateCompat.CustomAction.Builder(
            ACTION_HEART,
            if (isLiked) "Remove from Liked Songs" else "Save to Liked Songs",
            if (isLiked) R.drawable.ic_heart else R.drawable.ic_heart_outline
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
            if (liked == true) R.drawable.ic_heart else R.drawable.ic_heart_outline,
            if (liked == true) "Remove from Liked Songs" else "Save to Liked Songs",
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
            }.onFailure { Log.w("SpotifyAlt", "Artwork didn't load", it) }.getOrNull() ?: return@thread

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
