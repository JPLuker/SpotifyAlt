package com.jpluker.spotifyalt

import java.net.URI

/** Which pages load in the app, which go to the browser, which go nowhere. Pure, unit tested. */
object UrlPolicy {
    enum class Decision { LOAD, EXTERNAL, BLOCK }

    const val PLAYER_HOST = "open.spotify.com"

    // The player, Spotify's sign-in pages, and the sign-in providers Spotify offers.
    private val inAppHosts = setOf(
        PLAYER_HOST,
        "accounts.spotify.com",
        "challenge.spotify.com",
        "accounts.google.com",
        "www.facebook.com",
        "m.facebook.com",
        "appleid.apple.com",
    )

    fun decide(raw: String?): Decision {
        if (raw == null) return Decision.BLOCK
        if (raw == "about:blank") return Decision.LOAD
        val uri = parse(raw) ?: return Decision.BLOCK
        val scheme = uri.scheme?.lowercase()
        if (uri.rawUserInfo != null) return Decision.BLOCK
        return when {
            scheme == "https" && uri.host?.lowercase() in inAppHosts -> Decision.LOAD
            scheme == "https" || scheme == "http" -> Decision.EXTERNAL
            // spotify:, intent:, market:, file:, javascript:, data: and the rest.
            else -> Decision.BLOCK
        }
    }

    fun isPlayer(raw: String?): Boolean {
        val uri = parse(raw ?: return false) ?: return false
        return uri.scheme == "https" && uri.host == PLAYER_HOST && uri.rawUserInfo == null
    }

    /** A link from another app, as a player URL, or null. */
    fun playerUrlFrom(raw: String?): String? = if (isPlayer(raw)) raw else null

    private fun parse(raw: String): URI? = runCatching { URI(raw) }.getOrNull()
}
