# Heartline (desktop)

The Spotify web player in its own window, with the heart button back. Part of [SpotifyAlt](../README.md); the Android app is in `app/`.

- **The heart.** One click saves a song to Liked Songs, one click takes it out. A full heart means the song is in Liked Songs, not just in one of your playlists. It's on every song row and in the now-playing bar.
- **Media controls.** Media keys and your desktop's player controls work (the Sound indicator on elementary OS, the media flyout on Windows). The window title shows the current song.
- **Playback menu.** Play/Pause, Next, Previous and Like/Unlike (`Ctrl+Shift+L`). A tray menu with the same controls shows up when your desktop has a tray and `build/icons/tray.png` exists.
- **A calmer Spotify.** Warm dark grays, no green, quieter sidebars and the system font. Turn it off in settings if you want Spotify's own look.
- **Settings.** `Ctrl+,` in the app, `Alt+Shift+H` in Chrome. Turn the restyle or the hearts off, keep Spotify's + button next to them, hide the Premium and download prompts, or add your own CSS.

## Install

**Linux:** the `.deb` is the one to use on elementary OS and Ubuntu 24.04. The AppImage runs into Ubuntu's sandbox limits on those systems and has to be started with `--no-sandbox`.

**Windows:** the installer, the MSI or the portable `.exe`.

**Chrome or any Chromium browser:** unzip `Heartline-<version>-Extension.zip` (or use the repo's `extension/` folder), open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick the folder. The extension is the same code the app runs.

You sign in with your Spotify account inside the app. Email and password sign-in works. Google sign-in may refuse to open in an embedded browser; if it does, set a Spotify password from your account page and use that.

## Network connections

| Host | When | What it sends |
|---|---|---|
| `*.spotify.com`, `*.scdn.co`, `*.spotifycdn.com` | While you use it | The same requests Spotify's web player makes. Heartline adds Liked Songs lookups and saves to `api-partner.spotify.com`, using the sign-in token Spotify's own page already sends. |
| Google's component updater | First start, then now and then (app only) | Downloads and updates the Widevine module Spotify needs for playback. Sends the platform and version, the same as Chrome does. |

Heartline keeps the Spotify token in memory only. It's never saved and never sent anywhere except back to Spotify. Settings are stored on your computer. No analytics, no tracking.

## Build

```bash
cd desktop
npm ci
npm start            # run from source
npm test             # unit tests and the page script against Spotify-like markup
npm run smoke        # starts the real app against a test page (needs a display; use xvfb-run on a server)
npx electron-builder --linux deb --x64
```

Electron here is [castLabs' build](https://github.com/castlabs/electron-releases) with Widevine. Stock Electron opens Spotify but can't play anything.

## Credits

Made by Joseph Luker.

The heart lookup approach and the starting query hashes come from [Heartify](https://github.com/momir64/heartify) by Momir Stanišić (TWAORPWB license). Built on [Electron for Content Security](https://github.com/castlabs/electron-releases) by castLabs.

Not made by, endorsed by or connected to Spotify.
