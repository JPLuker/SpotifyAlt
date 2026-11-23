# SpotifyAlt architecture

Since 0.3.0 (2026-11-23) the Android app is a one-site browser for open.spotify.com, the same model as the desktop app. The earlier design (WebView + Spotify's Web Playback SDK with its own UI and OAuth) is in git history before commit `4fa1312`.

## Layers

```text
open.spotify.com (Spotify's own player and UI)
        │  page script in the main world: extension/heartline.js
        │    hearts, restyle, settings panel, now-playing state
        │  window.postMessage
        ▼
android-bridge.js (isolated content script)
        │  native messaging port "heartline"
        ▼
PlayerSession (Kotlin, one per process)
        │  GeckoView MediaSession: play, pause, next, previous, seek, position
        ▼
SpotifyAltService: Android MediaSession + media notification (with the heart)
```

- **GeckoView** runs the site with a desktop user agent (Spotify's mobile site sends people to its app) and a mobile viewport. "Fit to phone width" adds a `width=device-width` viewport.
- **The extension** is built in: Gradle's `heartlineAssets` task copies `extension/heartline.js` and `heartline.css`, adds `app/src/main/heartline-android/`, and writes the manifest from the shared one plus `manifest.overlay.json`. Built-in extensions may use native messaging from content scripts (`nativeMessagingFromContent`, `geckoViewAddons`).
- **Transport** goes through GeckoView's media session, which carries the actions Spotify registers. If there isn't one yet, the extension presses Spotify's own buttons.
- **The heart** always goes through the extension, which saves or removes with Spotify and reports the real state back. The notification never guesses.

## Rules

1. **Spotify's player is the player.** Android mirrors its state and sends commands; it never plays anything itself.
2. **The heart is never contextual.** `♡` means not in Liked Songs, `♥` means in Liked Songs. Unknown shows as empty and asks Spotify.
3. **One session for the process.** It outlives the activity, so rotation, back and app switching don't stop music.
4. **The page is untrusted input.** Messages from it are shape-checked (`PlayerState.fromExtension`).
5. **Only Spotify and sign-in pages load in the app.** Everything else opens in the browser; app links (`spotify:`, `intent:`) go nowhere (`UrlPolicy`).

## Known risks to check on a phone

- Widevine through Android's MediaDrm in GeckoView: the permission is granted for open.spotify.com, and prefs are set through GeckoView's config file (read in debuggable builds).
- Background playback while the screen is off.
- Whether Spotify's desktop layout is usable at phone width.
