# SpotifyAlt

SpotifyAlt is a **web-first Spotify controller packaged inside a purpose-built Android browser shell**.

The goal is not to rebuild Spotify natively or keep patching Spotify's APK. The goal is to make the web app feel like a real installed media app while native Android code supplies the platform capabilities normal PWAs do not reliably get.

The defining behavior is deliberately simple:

- `♡` = the current track is **not** in Liked Songs.
- `♥` = the current track **is** in Liked Songs.
- Tapping the heart changes that exact state only. It never means "in some playlist."

## Architecture

SpotifyAlt has three layers:

1. **Web app / PWA** — interface, Spotify-facing logic, player/controller UX and most future features.
2. **Android browser shell** — a dedicated WebView runtime that hosts the web app like a single-site browser and exposes a small native bridge.
3. **Native media bridge** — Android MediaSession, notification-shade controls, lock-screen controls, background behavior and hardware/Bluetooth media buttons.

The native Android layer is intentionally thin. The web application is the product.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full design.

## Current alpha

`0.1.1-alpha` begins the browser-shell pivot:

- MainActivity is now a dedicated web-app runtime rather than a conventional settings Activity.
- Bundled web assets are served from an HTTPS-like app-assets origin using `WebViewAssetLoader`.
- JavaScript can feature-detect `window.SpotifyAltNative` for Android-only capabilities.
- The web bundle includes a PWA manifest and service worker.
- Spotify OAuth still uses Authorization Code + PKCE and does not embed a client secret.
- The original Spotify MediaSession mirroring service remains temporarily as the Stage A playback bridge.

## Intended final behavior

The preferred end state is for SpotifyAlt itself to become the active Spotify Connect playback device through Spotify's Web Playback SDK inside the browser runtime. The Android shell then mirrors the web player's state into a native MediaSession.

That should give us:

- one SpotifyAlt media card in Android's swipe-down panel;
- previous / play-pause / next;
- a real Liked Songs heart;
- album art, title, artist and progress;
- lock-screen controls;
- hardware/Bluetooth media-key handling;
- a UI that remains mostly ordinary HTML/CSS/JS and can also run as a normal PWA.

The main technical risk is Web Playback SDK/encrypted-media behavior inside Android WebView plus reliable background playback. That must be validated on a real phone before Stage B is treated as viable.

## Spotify developer setup

For the current alpha:

1. Create an app in the Spotify Developer Dashboard.
2. Copy its Client ID.
3. Add this redirect URI:

   `http://127.0.0.1:43821/callback`

4. Build/install SpotifyAlt.
5. Enter the Client ID in SpotifyAlt and connect.

## Development rule

If a feature can live in the web layer, it should live in the web layer. Native Kotlin should be used for Android capabilities the web platform cannot provide cleanly.
