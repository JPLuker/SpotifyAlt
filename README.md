# SpotifyAlt

The Spotify web player as its own app, with the heart button back and Spotify restyled.

- **Android** (`app/`): a dedicated browser built on GeckoView (Firefox's engine) that runs open.spotify.com.
- **Desktop** (`desktop/`, called Heartline): the same idea for Linux and Windows, on castLabs Electron. See [desktop/README.md](desktop/README.md).
- **The extension** (`extension/`): the part that changes Spotify. Both apps run it, and it also works in Chrome.

## What you get

- **The heart.** One tap saves a song to Liked Songs, one tap takes it out. A full heart means it's in Liked Songs, not just in some playlist. It's on every song row, in the now-playing bar and in Android's media card.
- **A calmer Spotify.** Warm dark grays, no green, quieter chrome and your system font. You can turn it off.
- **Media controls.** Android's notification and lock-screen card with Like, Previous, Play/Pause and Next. Headset and Bluetooth buttons work too.
- **No setup.** Sign in with your Spotify account inside the app. No developer account, no client ID.

## Android

Install the APK from the latest "Android CI" run (Actions tab, `spotifyalt-debug` artifact). It's arm64 only, which covers current phones.

- **Phone layout:** Spotify's desktop player is laid out at your screen's width: nav on top, the page, the player at the bottom. The Library button next to Home opens your library full screen.
- **Settings:** long-press the app icon and choose **Heartline settings**. You can turn the restyle, the hearts and the phone layout on or off there, and add your own CSS. **Copy diagnostic info** copies what's needed to fix a problem (no passwords or tokens).
- **Back** goes back a page. At the start page it sends the app to the background so music keeps playing.
- Spotify web links open in SpotifyAlt when you pick it from the "Open with" list.

## Network connections

| Host | When | What it sends |
|---|---|---|
| `*.spotify.com`, `*.scdn.co`, `*.spotifycdn.com` | While you use it | The same requests Spotify's web player makes. Heartline adds Liked Songs lookups and saves to `api-partner.spotify.com`, using the sign-in token Spotify's own page already sends. The media card loads album art from Spotify's image server. |
| Google's Widevine services | When playback starts | Android's DRM system fetches licenses for Spotify's protected audio, the same as any browser. |

On Android, Firefox's tracker blocking is on, with analytics added, so Spotify's page can't send your listening to Google Analytics. Ads aren't blocked.

The Spotify token stays in memory and is never saved or sent anywhere but Spotify. Settings stay on your phone. No analytics, no tracking.

## Build

```bash
gradle :app:testDebugUnitTest :app:assembleDebug      # Android (needs JDK 17 and the Android SDK)
cd desktop && npm ci && npm test && npm run smoke    # desktop and the extension
```

CI builds both on every push. Android needs AGP 9.1, Gradle 9.3 and compileSdk 37 because GeckoView 160 does.

## Credits

Made by Joseph Luker. GeckoView by Mozilla. The heart lookup approach and starting query hashes come from [Heartify](https://github.com/momir64/heartify) by Momir Stanišić.

Not made by, endorsed by or connected to Spotify.
