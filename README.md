# SpotifyAlt

SpotifyAlt is an Android companion for the stock Spotify app. Its job is deliberately narrow: keep Spotify as the real player, but restore a persistent, old-style **Liked Songs heart** in Android's notification shade alongside familiar media controls.

## Current MVP

- Uses Spotify's own Android app for playback.
- Reads the active Spotify media session for title, artist, artwork and transport controls.
- Publishes a separate MediaStyle notification with previous / play-pause / next / **heart**.
- The heart maps only to Spotify's real library state: `♡` = not saved, `♥` = saved.
- Uses Spotify Web API Authorization Code + PKCE. No client secret is stored in the app.
- Uses Spotify's current generic library endpoints (`/me/library` and `/me/library/contains`) rather than the removed legacy `/me/tracks` endpoints.
- Includes a tiny local web UI (bundled HTML/CSS/JS in a WebView) for setup/status, with native Android handling the media session and notification.

## Before first run

1. Create an app in the Spotify Developer Dashboard.
2. Copy its **Client ID**.
3. Add this redirect URI to the Spotify app:

   `http://127.0.0.1:43821/callback`

4. Build/install SpotifyAlt.
5. Open SpotifyAlt, enter the Client ID, and press **Connect Spotify**.
6. Android will open Spotify authorization in your browser and return to the local callback listener.
7. Grant SpotifyAlt **Notification access** when prompted. This is what lets it mirror/control Spotify's active MediaSession.
8. Start playback in Spotify. SpotifyAlt should publish its own notification controls.

## Why a hybrid app?

A PWA can do Spotify OAuth and library API calls, but Android browsers do not provide reliable control over a persistent system media notification when the browser is backgrounded. SpotifyAlt therefore keeps the configuration UI web-based, while a thin native Android layer owns the MediaSession, foreground service, notification actions, and Spotify-session bridge.

## Security

- OAuth uses PKCE.
- No Spotify client secret is required or embedded.
- Access/refresh tokens are stored only in the app's private SharedPreferences.
- The local OAuth callback server binds to `127.0.0.1` only.

## Status

This is an initial MVP scaffold. The main things to validate on a physical Android phone are:

- Spotify exposes enough MediaSession metadata on the device/OS version.
- Android renders the companion MediaStyle notification the way we want.
- Background restrictions do not kill the companion service during normal music playback.
- Spotify Web API development-mode access is configured correctly for the account.

## Planned next steps

- Better notification artwork and state synchronization.
- Quick Settings heart tile.
- Optional lock-screen presentation.
- Configurable button order.
- More resilient reconnect behavior after reboot/app updates.
- Release APK workflow/signing once the interaction model is validated.
