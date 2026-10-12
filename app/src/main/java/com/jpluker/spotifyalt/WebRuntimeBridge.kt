package com.jpluker.spotifyalt

/**
 * Process-local command path from Android MediaSession callbacks back into the WebView player.
 * If the WebView is gone, the playback runtime is gone as well, so commands are intentionally
 * best-effort rather than persisted.
 */
object WebRuntimeBridge {
    @Volatile
    var commandSink: ((String) -> Unit)? = null

    fun send(command: String) {
        commandSink?.invoke(command)
    }
}
