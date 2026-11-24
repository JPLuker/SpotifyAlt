# Changelog

## [0.2.7] — 2026-11-23
### Fixed
- The now-playing heart finds the current song from any track link in the bar, not only the old context link.

## [0.2.6] — 2026-11-23
### Changed
- Shared page script: the Android phone layout only touches the desktop player's markup.

## [0.2.5] — 2026-11-23
### Changed
- Shared page script update for the Android phone layout (no desktop change).

## [0.2.4] — 2026-11-23
### Changed
- Shared page script update for the Android phone layout (no desktop change).

## [0.2.3] — 2026-11-23
### Fixed
- Restyle didn't apply on the live site: Spotify puts its theme class on `<html>`, and its layout now uses `#global-nav-bar`, `#Desktop_LeftSidebar_Id` and `#main-view` instead of `Root__` classes.
### Added
- "Copy diagnostic info" in settings: version, page width, DRM result, player state and recent errors, with tokens removed.

## [0.2.2] — 2026-11-23
### Changed
- On touch screens the empty heart stays visible on every row (there's no hover).
- The page script also runs in the Android app (phone-width layout option there).

## [0.2.1] — 2026-11-23
### Fixed
- Windows builds no longer fail without an app icon. The MSI waits for the icon; the installer and portable `.exe` build now.

## [0.2.0] — 2026-11-23
### Added
- Restyle Spotify: the web player in the Quiet Precision look (warm dark neutrals, ink instead of green, quieter sidebars, system font). On by default; "Restyle Spotify" in settings turns it off.
### Changed
- Settings panel uses Quiet Precision switches, buttons and dialog.
- The filled heart is ink instead of green while the restyle is on.
### Fixed
- `npm ci` now downloads the castLabs Electron binary.

## [0.1.0] — 2026-11-23
### Added
- Desktop app: the Spotify web player in its own window, on castLabs Electron (Widevine) so music plays.
- Heart buttons on song rows and in the now-playing bar. One click saves to or removes from Liked Songs. Spotify's + button comes back by itself if a lookup fails.
- Media keys and desktop media controls, a Playback menu with Like/Unlike (`Ctrl+Shift+L`), current song in the window title, optional tray menu.
- Settings panel (`Ctrl+,` in the app, `Alt+Shift+H` in Chrome): hearts on or off, keep Spotify's + button, hide Premium and download prompts, custom CSS.
- The same page script as a Chrome extension.
- "Can't reach Spotify" page with a retry when the player won't load.
