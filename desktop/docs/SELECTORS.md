# Spotify page hooks

Everything Heartline relies on in Spotify's web player. When Spotify changes something, it breaks here first. All of these live at the top of `extension/heartline.js` (`SEL`, `NATIVE_LABELS`, `DEFAULT_HASHES`).

| What | Where we find it | If it breaks |
|---|---|---|
| Spotify's own save button | `button[aria-label="Add to Liked Songs"]`, `button[aria-label="Add to playlist"]` | No hearts. Spotify's button stays (safe). English labels only. |
| Song rows | `[data-testid="tracklist-row"]` with a link containing `/track/<id>` | No hearts in lists. |
| Now playing bar | `[data-testid="now-playing-widget"]`, link `a[data-testid="context-link"]` (`?uri=spotify:track:…`) | No heart in the bar. |
| Now Playing view | `[data-testid="NPV_Panel_OpenDiv"]` | No heart in the side panel. |
| Current song | The player's WebSocket ("dealer") message `payloads[].cluster.player_state.track.uri`; falls back to the bar's link | Bar heart may point at the last song until the link updates. |
| Play, next, previous | `[data-testid="control-button-playpause"]`, `control-button-skip-forward`, `control-button-skip-back` | Tray and menu controls do nothing. Media keys still work (Chromium handles those). |
| Library API | `POST https://api-partner.spotify.com/pathfinder/v2/query`, operations `areEntitiesInLibrary`, `addToLibrary`, `removeFromLibrary` | Settings shows "lookup failed"; Spotify's button comes back. |
| Query hashes | Learned from the page's own requests and saved; defaults from Heartify 1.0.15 | Same as above until the page sends one of these operations itself (save or unsave any song once with Spotify's own button). |
| Premium/download prompts | `[data-testid="upgrade-button"]`, links to `/premium` and `/download` | Prompts stay visible. Not checked against the live site yet. |
| Restyle colors | Encore token sets `.encore-dark-theme`, `.encore-base-set`, `.encore-bright-accent-set` (`--background-*`, `--text-*`, `--essential-*`, `--decorative-*`, `--encore-*-font-stack`) | Spotify's own colors come back in that area. |
| Restyle layout | `.Root__top-container`, `.Root__nav-bar`, `.Root__main-view`, `.Root__right-sidebar`, `.Root__globalNav`, `.Root__now-playing-bar` | Panels keep Spotify's black and gray. Not checked against the live site yet. |
