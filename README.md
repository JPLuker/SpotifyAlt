# SpotifyAlt

SpotifyAlt is a **web-first Spotify player packaged inside a purpose-built Android browser shell**.

The point is simple: keep the application PWA-like, but give it the Android capabilities a normal browser PWA does not reliably get. SpotifyAlt itself becomes a Spotify Connect playback device through Spotify's Web Playback SDK, then mirrors that web player into Android's MediaSession.

The defining behavior is deliberately strict:

- `♡` = the current track is **not** in Liked Songs.
- `♥` = the current track **is** in Liked Songs.
- Tapping the heart changes that exact state only. It never means "in some playlist."

## 0.2.0-alpha

The old proxy design that watched the official Spotify Android app has been removed. The current build now attempts the intended architecture directly:

1. The bundled HTML/CSS/JS app loads in a dedicated Android WebView runtime.
2. Spotify OAuth uses Authorization Code + PKCE. No client secret is embedded.
3. The web app loads Spotify's Web Playback SDK and registers **SpotifyAlt** as a Spotify Connect device.
4. Tapping **Play here** activates the browser audio element and transfers playback to SpotifyAlt.
5. Web player metadata is sent through `window.SpotifyAltNative` into a native Android MediaSession.
6. The Android swipe-down media card exposes previous, play/pause, next and a real Liked Songs heart.
7. Native media-button events are routed back into the web player.

The web app also includes a basic track search so the first physical-device test does not have to depend on the official Spotify app for choosing every track.

## Architecture

SpotifyAlt has three layers:

- **Web app / PWA layer** — interface, Web Playback SDK, track search, player state, Liked Songs state and most product logic.
- **Android browser shell** — dedicated WebView runtime, Spotify authentication handoff and a deliberately small JavaScript bridge.
- **Native media adapter** — Android MediaSession, notification-shade controls, lock-screen controls and hardware/Bluetooth media buttons.

If a feature can sensibly live in HTML/CSS/JS, it should. Native Kotlin exists to expose Android platform capabilities to the web application.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the design contract.

## Spotify developer setup

You need Spotify Premium for the Web Playback SDK.

1. Create an app in the Spotify Developer Dashboard.
2. Enable/use both the **Web API** and **Web Playback SDK** for the app.
3. Add this exact redirect URI:

   `http://127.0.0.1:43821/callback`

4. Build/install SpotifyAlt.
5. Paste the Spotify app's **Client ID** into SpotifyAlt and connect.
6. Complete authorization in the browser and return to SpotifyAlt.
7. Wait for the diagnostics panel to show **Spotify Web Playback SDK: ready**.
8. Tap **Play here**.

## What to test on a physical Android phone

The Android build already compiles in CI. The important unknowns cannot be proven by desktop CI because they depend on Android System WebView and DRM/EME support:

- Does Spotify Web Playback SDK initialize inside the installed System WebView?
- Does audio continue normally with SpotifyAlt backgrounded?
- Does Android keep the MediaSession card alive while WebView is playing?
- Does the heart appear in the expected slot in your Android notification-shade media player?
- Do lock-screen and Bluetooth/headset buttons route back to the web player?

SpotifyAlt exposes the installed System WebView version and Web Playback SDK state directly in its diagnostics panel so failures can be debugged precisely.

## Build

GitHub Actions builds a debug APK on every push. The artifact is named:

`spotifyalt-debug`

Local build:

```bash
gradle :app:assembleDebug
```

## Current limitations

- Spotify Web Playback SDK requires Spotify Premium.
- The PWA bundle is portable, but OAuth is still delegated to the Android bridge in this alpha. A fully standalone browser/PWA PKCE flow is a later step.
- WebView encrypted-media support is the main technical risk. If the SDK reports an initialization/EME failure on the target phone, the diagnostics from the physical device will determine whether we can keep the pure WebView approach or need a different Chromium runtime.
- Search/player UX is intentionally minimal until playback-in-WebView is proven.
