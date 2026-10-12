package com.jpluker.spotifyalt

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.PlaybackState
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.session.MediaButtonReceiver
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import kotlin.concurrent.thread

class SpotifyAltService : Service() {
    companion object {
        private const val CHANNEL_ID = "spotifyalt_media"
        private const val NOTIFICATION_ID = 1701
        private const val ACTION_PREVIOUS = "com.jpluker.spotifyalt.PREVIOUS"
        private const val ACTION_TOGGLE = "com.jpluker.spotifyalt.TOGGLE"
        private const val ACTION_NEXT = "com.jpluker.spotifyalt.NEXT"
        private const val ACTION_HEART = "com.jpluker.spotifyalt.HEART"
    }

    private lateinit var session: MediaSessionCompat
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var liked = false
    @Volatile private var currentUri: String? = null
    private val observer = { refreshFromSpotify() }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        session = MediaSessionCompat(this, "SpotifyAlt").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = transport { it.play() }
                override fun onPause() = transport { it.pause() }
                override fun onSkipToNext() = transport { it.skipToNext() }
                override fun onSkipToPrevious() = transport { it.skipToPrevious() }
            })
            isActive = true
        }
        PlaybackBridge.addObserver(observer)
        startForeground(NOTIFICATION_ID, buildNotification("Waiting for Spotify", "Start playback in Spotify"))
        schedulePoll()
    }

    override fun onDestroy() {
        PlaybackBridge.removeObserver(observer)
        handler.removeCallbacksAndMessages(null)
        session.release()
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PREVIOUS -> transport { it.skipToPrevious() }
            ACTION_TOGGLE -> {
                val state = PlaybackBridge.controller()?.playbackState?.state
                transport { if (state == PlaybackState.STATE_PLAYING) it.pause() else it.play() }
            }
            ACTION_NEXT -> transport { it.skipToNext() }
            ACTION_HEART -> toggleHeart()
        }
        refreshFromSpotify()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun transport(action: (android.media.session.MediaController.TransportControls) -> Unit) {
        PlaybackBridge.controller()?.transportControls?.let(action)
    }

    private fun schedulePoll() {
        handler.post(object : Runnable {
            override fun run() {
                refreshFromSpotify()
                handler.postDelayed(this, 5000)
            }
        })
    }

    private fun refreshFromSpotify() {
        val controller = PlaybackBridge.controller()
        val metadata = controller?.metadata
        val title = metadata?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: "Waiting for Spotify"
        val artist = metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: "Start playback in Spotify"
        val playing = controller?.playbackState?.state == PlaybackState.STATE_PLAYING

        session.setMetadata(MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .build())
        session.setPlaybackState(PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            )
            .setState(if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED, 0L, 1f)
            .build())

        updateNotification(title, artist, playing)

        thread(name = "spotifyalt-library-state") {
            val track = runCatching { SpotifyApi.currentTrack(this) }.getOrNull() ?: return@thread
            val newLiked = runCatching { SpotifyApi.isSaved(this, track.uri) }.getOrDefault(false)
            currentUri = track.uri
            if (newLiked != liked) {
                liked = newLiked
                handler.post { updateNotification(title, artist, playing) }
            }
        }
    }

    private fun toggleHeart() {
        thread(name = "spotifyalt-heart") {
            val track = runCatching { SpotifyApi.currentTrack(this) }.getOrNull() ?: return@thread
            val target = !runCatching { SpotifyApi.isSaved(this, track.uri) }.getOrDefault(false)
            if (runCatching { SpotifyApi.setSaved(this, track.uri, target) }.getOrDefault(false)) {
                currentUri = track.uri
                liked = target
                handler.post { refreshFromSpotify() }
            }
        }
    }

    private fun updateNotification(title: String, artist: String, playing: Boolean) {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(title, artist, playing))
    }

    private fun buildNotification(title: String, artist: String, playing: Boolean = false) =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(artist)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(playing)
            .addAction(android.R.drawable.ic_media_previous, "Previous", action(ACTION_PREVIOUS, 1))
            .addAction(if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play, if (playing) "Pause" else "Play", action(ACTION_TOGGLE, 2))
            .addAction(android.R.drawable.ic_media_next, "Next", action(ACTION_NEXT, 3))
            .addAction(if (liked) android.R.drawable.btn_star_big_on else android.R.drawable.btn_star_big_off, if (liked) "Unlike" else "Like", action(ACTION_HEART, 4))
            .setStyle(MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(1, 3, 2))
            .build()

    private fun action(action: String, requestCode: Int): PendingIntent =
        PendingIntent.getService(
            this,
            requestCode,
            Intent(this, SpotifyAltService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    private fun createChannel() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "SpotifyAlt media controls", NotificationManager.IMPORTANCE_LOW))
    }
}
