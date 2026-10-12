package com.jpluker.spotifyalt

import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import kotlin.concurrent.thread

object SpotifyAuth {
    private const val PORT = 43821
    private const val REDIRECT_URI = "http://127.0.0.1:$PORT/callback"
    private const val SCOPES = "user-library-read user-library-modify user-read-playback-state user-read-currently-playing user-modify-playback-state"

    fun start(context: Context, status: (String) -> Unit) {
        val prefs = context.getSharedPreferences("spotifyalt", Context.MODE_PRIVATE)
        val clientId = prefs.getString("client_id", null)
        if (clientId.isNullOrBlank()) {
            status("Enter your Spotify Client ID first.")
            return
        }

        val verifier = randomVerifier()
        val challenge = base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
        val state = randomVerifier().take(24)
        prefs.edit().putString("pkce_verifier", verifier).putString("oauth_state", state).apply()

        thread(name = "spotifyalt-oauth-listener") {
            try {
                ServerSocket(PORT, 1, java.net.InetAddress.getByName("127.0.0.1")).use { server ->
                    status("Waiting for Spotify authorization…")
                    server.accept().use { socket ->
                        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                        val requestLine = reader.readLine().orEmpty()
                        val path = requestLine.split(" ").getOrNull(1).orEmpty()
                        val query = Uri.parse("http://127.0.0.1$path")
                        val code = query.getQueryParameter("code")
                        val returnedState = query.getQueryParameter("state")
                        val error = query.getQueryParameter("error")

                        val ok = error == null && !code.isNullOrBlank() && returnedState == state
                        val body = if (ok) "SpotifyAlt connected. You can close this tab." else "SpotifyAlt authorization failed. Return to the app and try again."
                        val response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.toByteArray().size}\r\nConnection: close\r\n\r\n$body"
                        socket.getOutputStream().write(response.toByteArray())
                        socket.getOutputStream().flush()

                        if (!ok) {
                            status("Spotify authorization failed${if (error != null) ": $error" else "."}")
                            return@use
                        }
                        exchangeCode(context, clientId, code!!, verifier)
                        status("Spotify connected. Enable notification access, then start the companion.")
                    }
                }
            } catch (e: Exception) {
                status("OAuth failed: ${e.message ?: e.javaClass.simpleName}")
            }
        }

        val authUri = Uri.parse("https://accounts.spotify.com/authorize").buildUpon()
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("redirect_uri", REDIRECT_URI)
            .appendQueryParameter("scope", SCOPES)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("state", state)
            .build()
        context.startActivity(Intent(Intent.ACTION_VIEW, authUri))
    }

    private fun exchangeCode(context: Context, clientId: String, code: String, verifier: String) {
        val body = form(
            "client_id" to clientId,
            "grant_type" to "authorization_code",
            "code" to code,
            "redirect_uri" to REDIRECT_URI,
            "code_verifier" to verifier
        )
        val conn = URL("https://accounts.spotify.com/api/token").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        conn.outputStream.use { it.write(body.toByteArray()) }
        val text = conn.inputStream.bufferedReader().use { it.readText() }
        val json = JSONObject(text)
        val prefs = context.getSharedPreferences("spotifyalt", Context.MODE_PRIVATE)
        prefs.edit()
            .putString("access_token", json.getString("access_token"))
            .putString("refresh_token", json.optString("refresh_token", prefs.getString("refresh_token", "")))
            .putLong("token_expires_at", System.currentTimeMillis() + json.optLong("expires_in", 3600) * 1000L - 60_000L)
            .apply()
    }

    private fun randomVerifier(): String {
        val bytes = ByteArray(48)
        SecureRandom().nextBytes(bytes)
        return base64Url(bytes)
    }

    private fun base64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    private fun form(vararg pairs: Pair<String, String>): String = pairs.joinToString("&") {
        java.net.URLEncoder.encode(it.first, "UTF-8") + "=" + java.net.URLEncoder.encode(it.second, "UTF-8")
    }
}
