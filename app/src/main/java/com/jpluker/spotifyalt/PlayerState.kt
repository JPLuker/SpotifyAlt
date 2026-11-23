package com.jpluker.spotifyalt

import org.json.JSONObject

/** What the media notification shows. Built from GeckoView's media session and the extension. */
data class PlayerState(
    val title: String = "",
    val artist: String = "",
    val album: String = "",
    val artworkUrl: String? = null,
    val playing: Boolean = false,
    val uri: String? = null,
    /** True = in Liked Songs, false = not, null = not known yet (lookup pending or failed). */
    val liked: Boolean? = null,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
) {
    companion object {
        private val TRACK_URI = Regex("^spotify:track:[A-Za-z0-9]{22}$")

        /** Applies a state message from the extension. Treated as untrusted input. */
        fun fromExtension(json: JSONObject, previous: PlayerState): PlayerState {
            fun str(key: String, max: Int) = json.optString(key, "").take(max)
            val uri = str("uri", 64).takeIf { TRACK_URI.matches(it) }
            val art = str("artwork", 1000).takeIf { it.startsWith("https://") }
            val liked = when (val v = json.opt("liked")) {
                is Boolean -> v
                else -> null
            }
            return previous.copy(
                title = str("title", 300),
                artist = str("artist", 300),
                album = str("album", 300),
                artworkUrl = art,
                playing = json.optBoolean("playing", previous.playing),
                uri = uri,
                liked = liked,
            )
        }
    }
}
