# SpotifyAlt — notes for agents

Read [JPLuker/InternalDesignGuidelines](https://github.com/JPLuker/InternalDesignGuidelines) first (README, SOP Part 1, WORKING-WITH-JOSEPH, WORKFLOW). Then the open issues in this repo.

## What's here
| Path | What |
|---|---|
| `app/` | Android app (0.2.0-alpha, Oct 2026): WebView + Spotify Web Playback SDK with its own UI. See `ARCHITECTURE.md`. |
| `desktop/` | **Heartline**, the desktop app (Linux, Windows): castLabs Electron running `https://open.spotify.com` with the page script injected. |
| `extension/` | The page script: one-click Liked Songs hearts, settings panel, custom CSS, app bridge. Runs in Spotify's page (main world). Shared by the desktop app and Chrome, and planned for Android. |

## Direction (Joseph, 2026-11-23)
"Both, Android first": desktop ships from `desktop/`; next, the Android app is rebuilt the same way, a dedicated browser running open.spotify.com with `extension/` changing the UI, plus Android media controls. Joseph also asked for a **full restyle** of Spotify's UI through the extension; the look itself is his call (DESIGN.md B0), so confirm the direction before building it.

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
- **`.github/workflows/android.yml` predates the standards** (actions pinned to tags, no path filter). Fix it in the Android rework.

## Waiting on Joseph
The restyle direction, the license, and the app and tray icons (human-made art). Each is an open issue.
