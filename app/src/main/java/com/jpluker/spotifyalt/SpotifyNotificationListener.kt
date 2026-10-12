package com.jpluker.spotifyalt

import android.content.ComponentName
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.service.notification.NotificationListenerService

class SpotifyNotificationListener : NotificationListenerService() {
    override fun onListenerConnected() {
        super.onListenerConnected()
        PlaybackBridge.listenerComponent = ComponentName(this, SpotifyNotificationListener::class.java)
        refreshController()
    }

    override fun onNotificationPosted(sbn: android.service.notification.StatusBarNotification?) {
        if (sbn?.packageName == "com.spotify.music") refreshController()
    }

    override fun onNotificationRemoved(sbn: android.service.notification.StatusBarNotification?) {
        if (sbn?.packageName == "com.spotify.music") refreshController()
    }

    private fun refreshController() {
        val manager = getSystemService(MEDIA_SESSION_SERVICE) as MediaSessionManager
        val controller = try {
            manager.getActiveSessions(ComponentName(this, SpotifyNotificationListener::class.java))
                .firstOrNull { it.packageName == "com.spotify.music" }
        } catch (_: SecurityException) {
            null
        }
        PlaybackBridge.setController(controller)
    }
}

object PlaybackBridge {
    @Volatile var listenerComponent: ComponentName? = null
    @Volatile private var controller: MediaController? = null
    private val observers = mutableSetOf<() -> Unit>()

    @Synchronized fun setController(value: MediaController?) {
        controller = value
        observers.toList().forEach { it.invoke() }
    }

    fun controller(): MediaController? = controller

    @Synchronized fun addObserver(observer: () -> Unit) { observers += observer }
    @Synchronized fun removeObserver(observer: () -> Unit) { observers -= observer }
}
