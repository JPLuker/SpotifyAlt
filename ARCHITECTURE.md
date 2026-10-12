# SpotifyAlt Architecture

SpotifyAlt is a **web application running inside a purpose-built Android browser runtime**. It is not a patched Spotify client and it is no longer designed around mirroring the official Spotify Android app.

## Product model

Think of SpotifyAlt as a one-site browser/runtime:

- The **web app** is the product. It owns the interface, Web Playback SDK, Spotify-facing product logic, navigation, player state and most features.
- The **Android shell** hosts that web app full-screen and exposes only the platform capabilities that normal PWAs cannot reliably own.
- The **native media adapter** projects the web player's state into Android System UI and sends Android media-button events back into JavaScript.

The web bundle should remain portable enough to become a normal installable PWA later. When `window.SpotifyAltNative` exists, Android-only integrations become available.

## Runtime layers

### 1. Web application

Responsibilities:

- Spotify player/controller UI.
- Spotify Web Playback SDK lifecycle.
- Registering SpotifyAlt as a Spotify Connect device.
- Current-track state and progress.
- Track search and future library/queue screens.
- Real Liked Songs state (`♡` vs `♥`).
- Transfer/playback commands through Spotify Web API.
- Feature flags and preferences.

The web app must feature-detect the native bridge rather than assuming Android.

### 2. Android browser shell

Responsibilities:

- Host the web application in a dedicated WebView runtime.
- Serve the bundled web app from the HTTPS-like `appassets.androidplatform.net` origin rather than `file://`.
- Allow Web Playback SDK network/media resources.
- Expose `window.SpotifyAltNative`.
- Handle Spotify PKCE authorization handoff.
- Keep the app free of general browser chrome.
- Surface runtime diagnostics such as the installed System WebView version.

The shell should remain intentionally thin. Product UI should not migrate into Android XML/Compose unless an Android limitation requires it.

### 3. Native media adapter

Responsibilities:

- Publish SpotifyAlt's `MediaSession` to Android System UI.
- Render notification-shade and lock-screen media controls.
- Provide previous / play-pause / next and a real Liked Songs action.
- Receive web-player title, artist, artwork, duration, position and playing state.
- Send hardware/media-button commands back into the active web runtime.
- Maintain enough native state for notification actions to respond immediately.

## Playback model

SpotifyAlt attempts to become the active local Spotify Connect device directly through Spotify's Web Playback SDK.

Flow:

```text
Spotify account / Connect
        ↓
Spotify Web Playback SDK
        ↓
SpotifyAlt web application
        ↓
SpotifyAltNative bridge
        ↓
Android MediaSession
        ↓
Notification shade / lock screen / media buttons
```

There should be no dependency on notification-listener access to the official Spotify app.

## Native bridge contract

JavaScript namespace:

`window.SpotifyAltNative`

Current Android-to-web and web-to-Android responsibilities include:

- `runtime()` — shell/version identity.
- `webViewVersion()` — installed Chromium/System WebView version.
- `connectSpotify(clientId)` — start native PKCE authorization.
- `accessToken()` — provide a valid/refreshable Spotify access token to the web runtime.
- `isSaved(uri)` / `setSaved(uri, saved)` — strict Liked Songs state.
- `startMediaBridge()` — start Android MediaSession foreground service.
- `updateMediaState(json)` — publish web-player state to Android.
- `stopMediaBridge()` — stop the native media adapter.
- `openUrl(url)` — intentional external navigation.

Native media commands are routed into:

```js
window.SpotifyAltApp.nativeCommand(command)
```

Current commands include `play`, `pause`, `previous`, `next`, `seek:<milliseconds>` and `liked:<boolean>`.

## Source of truth rules

1. **Playback state comes from the Web Playback SDK.** Android mirrors it; Android does not invent it.
2. **Liked Songs state comes from Spotify's library API.** A playlist membership never counts as a Like.
3. **The web player owns transport behavior.** Android MediaSession callbacks are commands into the web runtime.
4. **Native state is a projection.** It exists to render Android System UI, not as a second player implementation.

## Why not a conventional PWA alone?

A normal browser PWA can host the Web Playback SDK, but Android does not give it reliable first-class control over persistent notification-shade media actions, lock-screen layout, background service lifetime or custom native media actions. SpotifyAlt therefore keeps the product web-first while wrapping it in a small Android runtime.

## Primary technical risk

Spotify documents Web Playback SDK support for Android mobile browsers, but Android WebView is not explicitly guaranteed. The principal validation target is therefore encrypted-media/EME behavior inside the installed System WebView.

If the SDK produces an `initialization_error`, the first step is to capture the exact message and WebView version from SpotifyAlt's diagnostics. We should not silently fall back to patching Spotify or reintroduce the old notification-proxy architecture.

## Development rules

1. **Web first.** Build a feature in the web layer unless Android explicitly requires native code.
2. **No general browser chrome.** SpotifyAlt is a dedicated app runtime.
3. **One player truth.** Web state and Android MediaSession must not drift.
4. **The heart is never contextual.** `♡` means not in Liked Songs; `♥` means in Liked Songs.
5. **Native code is an adapter.** It exposes Android capabilities; it is not a second product implementation.
6. **Keep the PWA path viable.** Native APIs must be feature-detected and web code should degrade cleanly outside Android.

## Current status — 0.2.0-alpha

Implemented:

- Dedicated WebView browser shell.
- HTTPS-like app-assets origin.
- PWA manifest/service worker.
- Spotify Authorization Code + PKCE.
- Web Playback SDK player creation.
- SpotifyAlt Spotify Connect device registration.
- User-gesture activation and playback transfer.
- Web player controls and progress.
- Basic Spotify track search/play.
- Strict Liked Songs heart.
- Web-to-native media-state bridge.
- Native MediaSession with heart/previous/play-pause/next.
- Native-to-web media commands.
- Album artwork projection into the Android media notification.
- System WebView / SDK diagnostics.

Next milestone: physical-device validation of Web Playback SDK/EME and background playback behavior.
