# SpotifyAlt — notes for agents

Read [JPLuker/InternalDesignGuidelines](https://github.com/JPLuker/InternalDesignGuidelines) first (README, SOP Part 1, WORKING-WITH-JOSEPH, WORKFLOW). Then the open issues in this repo.

## What's here
| Path | What |
|---|---|
| `app/` | Android app (0.3.x): GeckoView browser for open.spotify.com with `extension/` built in, plus the media card. See `ARCHITECTURE.md`. |
| `desktop/` | **Heartline**, the desktop app (Linux, Windows): castLabs Electron running `https://open.spotify.com` with the page script injected. |
| `extension/` | The page script: one-click Liked Songs hearts, restyle, settings panel, custom CSS, app bridge. Runs in Spotify's page (main world). Shared by Android, desktop and Chrome. |

## Direction (Joseph, 2026-11-23)
"Both, Android first", then "We are focusing on android first". Android was rebuilt as GeckoView + the extension (Joseph: "just do whatever you want", taken as yes to GeckoView, issue #5). Desktop is done and on hold until he tests. He also asked for a **full restyle** of Spotify's UI through the extension (see Identity). The repo "will probably be private": no license, all rights reserved (issue #2).

## Android map
| Path | Job |
|---|---|
| `app/src/main/java/.../PlayerSession.kt` | GeckoRuntime and the one GeckoSession, delegates (navigation, permissions, crash, media), the extension port, commands |
| `app/src/main/java/.../SpotifyAltService.kt` | Foreground service: Android MediaSession and the media notification with the heart |
| `app/src/main/java/.../UrlPolicy.kt` | What loads in the app, what goes to the browser, what's blocked |
| `app/src/main/java/.../PlayerState.kt` | Now-playing state; parses the extension's messages |
| `app/src/main/heartline-android/` | Android-only extension files: main-world flag, isolated bridge, manifest overlay |
| `app/scripts/setup-signing.sh` | Joseph's one-line release key setup (SECURITY-BASELINE 2.1) |
| `app/src/test/` | JUnit tests; `desktop/test/android-bridge.test.js` covers the bridge script |

Android toolchain: AGP 9.1.1 (built-in Kotlin), Kotlin compiler 2.4.21, Gradle 9.3.1, compileSdk 37, all because GeckoView 160 requires them. GeckoView is pinned in `gradle.properties`; bump it on purpose, and keep it current since it's a browser engine.

## Identity
- Visual style: Quiet Precision — approved by Joseph 2026-11-23: asked for a "Full restyle", then for the look: "Check out internal guidelines standards"
- Accent: ink (`#EDEDEA` on dark); Spotify's green is replaced, including the big play button and the filled heart
- Neutrals: warm (default), dark only for now; Spotify's web player has no light theme to map yet
- Semantic shifts: none
- Display font: none (Geist if installed, else the system UI font)
- Shape: default
- Density: Spotify's own for now
- Signature detail: the heart
- How: `extension/heartline.css` part 4 maps Spotify's Encore tokens and `Root__` layout classes under `html.hl-qp`. "Restyle Spotify" in settings turns it off.

## Desktop map
| Path | Job |
|---|---|
| `desktop/src/main/main.js` | Window, session, navigation rules, menu, tray, IPC |
| `desktop/src/main/policy.js` | Which URLs stay in the app, which go to the browser |
| `desktop/src/main/store.js` | `settings.json` in userData (temp file, read back, swap) |
| `desktop/src/main/state.js` | Validates now-playing state from the page |
| `desktop/src/main/ua.js` | Chrome user agent from the bundled Chromium version |
| `desktop/src/preload/preload.js` | Sandboxed preload: injects the page script, relays state and commands |
| `desktop/docs/SELECTORS.md` | Every Spotify hook the page script depends on. Update it when Spotify changes |
| `desktop/test/` | `npm test` (node + jsdom), `npm run smoke` (real app against `test/fixtures/player.html`) |

## Rules for this repo
- **Desktop Electron must be castLabs ECS** (`electron@https://github.com/castlabs/electron-releases#v<ver>+wvcus`). Stock Electron has no Widevine. Bump by hand; Dependabot ignores it. Run the smoke test after a bump.
- **Desktop version lives in `desktop/package.json`.** `npm run version:sync` copies it into `extension/`; a test fails on drift. Android's version stays in `app/build.gradle.kts`.
- **Never store the Spotify token.** Memory only (SECURITY-BASELINE 2).
- **When a Spotify lookup fails, show Spotify's own button.** Never guess a heart state. `♡` = not in Liked Songs, `♥` = in Liked Songs, never "in some playlist".
- **Smoke test before every push** that touches `desktop/` or `extension/`. CI runs it with Widevine required.

## Deviations
- **Two products in one repo.** Desktop tags are `desktop-v<version>`; Android keeps its own. "Latest release" on GitHub can only point at one of them; desktop releases take it when published as tested.
- **Preload injection instead of `session.extensions.loadExtension`.** The script must wrap `fetch`, XHR and WebSocket before Spotify's first request, and Electron's extension support doesn't guarantee `"world": "MAIN"` content scripts. The smoke test proves the timing.
- **Page-script settings live in Spotify's `localStorage`.** That's the one place the app and Chrome can both read. No secrets go there.
- **No Flatpak yet** for desktop. Widevine inside the Flatpak sandbox needs its own work; it ships as an untested release first (RELEASES.md Part 4).
- **No macOS build, no auto-updater** in desktop 0.x.
- **Windows Widevine is not VMP-signed.** castLabs' EVS signing needs an account; until then Windows playback is unconfirmed.
- **Android is arm64 only** to keep GeckoView's size down (Joseph's phone is a Pixel).
- **Android release builds aren't minified** yet; GeckoView's R8 rules need checking first.
- **The Android debug APK is signed with CI's throwaway debug key** and won't install over the previous one. Signed releases need the key from `app/scripts/setup-signing.sh`.

## Waiting on Joseph
The Android release key (one line: `gh repo clone JPLuker/SpotifyAlt && cd SpotifyAlt && bash app/scripts/setup-signing.sh`), a phone test, and the app and tray icons (human-made art, issue #3).
