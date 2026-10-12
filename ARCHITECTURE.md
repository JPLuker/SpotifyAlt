# SpotifyAlt Architecture

SpotifyAlt is **not** intended to be a conventional native Spotify companion. The product is a web application that runs inside a purpose-built Android browser shell.

## Product model

Think of SpotifyAlt as a one-site browser/runtime:

- The **web app** owns the interface, Spotify-facing product logic, navigation, state and most feature development.
- The **Android shell** owns capabilities the web platform cannot reliably provide on its own: Android MediaSession integration, notification-shade controls, lock-screen controls, background lifecycle, hardware/Bluetooth media keys and other platform hooks.
- The same web UI should eventually be deployable as a normal PWA in Chrome or another browser. When it detects the Android bridge, it gains the extra native integrations.

This keeps the UI and most application behavior portable while still giving the installed Android build first-class system media controls.

## Runtime layers

### 1. Web application

Responsibilities:

- Spotify authentication UX.
- Player/controller UI.
- Current-track presentation.
- Real Liked Songs state (`♡` vs `♥`).
- Queue/library views as they are added.
- Feature flags and preferences.
- Web/PWA behavior when running outside the Android shell.

The web app must feature-detect the native bridge rather than assuming it exists.

### 2. Android browser shell

Responsibilities:

- Host the web app in a dedicated WebView runtime.
- Serve the bundled web app from an HTTPS-like app-assets origin instead of `file://`.
- Expose a small JavaScript bridge (`window.SpotifyAltNative`).
- Handle Android lifecycle and notification permission.
- Open external authentication/deep links safely outside the embedded app origin.
- Keep the web app looking and behaving like a standalone installed app rather than a general-purpose browser.

The shell should stay intentionally thin. Product UI should not migrate into Android XML/Compose unless a platform limitation requires it.

### 3. Native media bridge

Responsibilities:

- Publish SpotifyAlt's MediaSession to Android System UI.
- Render the notification-shade and lock-screen media card.
- Provide previous / play-pause / next and a real Liked Songs action.
- Reflect web playback metadata into Android.
- Send hardware/media-button commands back into the web runtime.
- Keep enough state native-side for notification actions to remain responsive while the Activity is backgrounded.

## Playback strategy

There are two viable stages.

### Stage A — controller/proxy mode

The installed Spotify app remains the audio player. SpotifyAlt is the web-first control surface and native system-integration layer.

This is useful for validating the UI, OAuth, heart behavior and notification plumbing quickly, but it can result in two Android media sessions/cards. It is therefore a transitional implementation, not the desired final architecture.

### Stage B — SpotifyAlt playback mode

SpotifyAlt becomes the active Spotify Connect playback device using Spotify's Web Playback SDK inside the browser runtime. The Android shell mirrors that web playback into a native MediaSession.

Desired outcome:

- SpotifyAlt is the only active local media session while it is being used.
- Android's media card belongs to SpotifyAlt.
- The web UI and Android notification represent the same player state.
- The heart has one strict meaning: current track is or is not in Liked Songs.

This path must be validated on a physical Android device because encrypted-media/WebView behavior and background playback are the largest technical risks.

## Native bridge contract

Initial bridge namespace:

`window.SpotifyAltNative`

Current functions are transitional and include Spotify auth/status helpers plus starting the existing media bridge. As the architecture matures, prefer a small message-oriented contract such as:

- `runtime()`
- `setMediaState(json)`
- `setLikedState(boolean)`
- `setPlaybackState(json)`
- `setAuthState(json)`
- `requestNativeCapability(name)`

Native-to-web events should converge on one web event surface, for example:

```js
window.dispatchEvent(new CustomEvent('spotifyalt:native', { detail }))
```

This keeps the PWA usable without native code and avoids coupling web features to Kotlin implementation details.

## Design rules

1. **Web first.** Build a web feature unless Android explicitly requires native code.
2. **No general browser chrome.** SpotifyAlt is a dedicated app runtime, not Chrome with a custom homepage.
3. **One source of player truth.** The web player state and Android MediaSession must not drift.
4. **The heart is never contextual.** `♡` means not in Liked Songs; `♥` means in Liked Songs.
5. **Native code is an adapter.** It should expose Android capabilities, not become a second product implementation.
6. **PWA remains viable.** The web layer should still launch and function in an ordinary browser with graceful loss of Android-only features.

## Current status

Version `0.1.1-alpha` begins the pivot:

- MainActivity is now a dedicated web-app shell.
- Local web assets are served through `WebViewAssetLoader` on an app-assets HTTPS origin.
- The shell exposes `SpotifyAltNative` to JavaScript.
- A basic PWA manifest and service worker are present.
- The original Spotify-session mirroring service remains temporarily in place for Stage A testing.

Next engineering milestone: replace the transitional mirror flow with a web-player/native-MediaSession bridge and validate Spotify Web Playback SDK behavior on the target Android device.
