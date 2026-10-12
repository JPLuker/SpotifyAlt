package com.jpluker.spotifyalt

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

object SpotifyApi {
    data class CurrentTrack(val uri: String, val name: String, val artist: String)

    fun currentTrack(context: Context): CurrentTrack? {
        val text = request(context, "GET", "https://api.spotify.com/v1/me/player/currently-playing") ?: return null
        if (text.isBlank()) return null
        val json = JSONObject(text)
        val item = json.optJSONObject("item") ?: return null
        val uri = item.optString("uri")
        if (!uri.startsWith("spotify:track:")) return null
        val artists = item.optJSONArray("artists")
        val artist = if (artists != null && artists.length() > 0) artists.getJSONObject(0).optString("name") else ""
        return CurrentTrack(uri, item.optString("name"), artist)
    }

    fun isSaved(context: Context, uri: String): Boolean {
        val encoded = URLEncoder.encode(uri, "UTF-8")
        val text = request(context, "GET", "https://api.spotify.com/v1/me/library/contains?uris=$encoded") ?: return false
        val array = JSONArray(text)
        return array.length() > 0 && array.optBoolean(0, false)
    }

    fun setSaved(context: Context, uri: String, saved: Boolean): Boolean {
        val body = JSONObject().put("uris", JSONArray().put(uri)).toString()
        return request(context, if (saved) "PUT" else "DELETE", "https://api.spotify.com/v1/me/library", body) != null
    }

    private fun request(context: Context, method: String, url: String, body: String? = null, retry: Boolean = true): String? {
        val token = accessToken(context) ?: return null
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.setRequestProperty("Authorization", "Bearer $token")
        conn.setRequestProperty("Content-Type", "application/json")
        if (body != null) {
            conn.doOutput = true
            conn.outputStream.use { it.write(body.toByteArray()) }
        }
        val code = conn.responseCode
        if (code == 401 && retry && refresh(context)) return request(context, method, url, body, false)
        if (code == 204) return ""
        if (code !in 200..299) return null
        return conn.inputStream.bufferedReader().use { it.readText() }
    }

    private fun accessToken(context: Context): String? {
        val prefs = context.getSharedPreferences("spotifyalt", Context.MODE_PRIVATE)
        if (prefs.getLong("token_expires_at", 0L) <= System.currentTimeMillis()) {
            if (!refresh(context)) return null
        }
        return prefs.getString("access_token", null)
    }

    private fun refresh(context: Context): Boolean {
        val prefs = context.getSharedPreferences("spotifyalt", Context.MODE_PRIVATE)
        val clientId = prefs.getString("client_id", null) ?: return false
        val refreshToken = prefs.getString("refresh_token", null)?.takeIf { it.isNotBlank() } ?: return false
        return try {
            val body = "client_id=${URLEncoder.encode(clientId, "UTF-8")}&grant_type=refresh_token&refresh_token=${URLEncoder.encode(refreshToken, "UTF-8")}"
            val conn = URL("https://accounts.spotify.com/api/token").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            conn.outputStream.use { it.write(body.toByteArray()) }
            if (conn.responseCode !in 200..299) return false
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            prefs.edit()
                .putString("access_token", json.getString("access_token"))
                .putString("refresh_token", json.optString("refresh_token", refreshToken))
                .putLong("token_expires_at", System.currentTimeMillis() + json.optLong("expires_in", 3600) * 1000L - 60_000L)
                .apply()
            true
        } catch (_: Exception) {
            false
        }
    }
}
