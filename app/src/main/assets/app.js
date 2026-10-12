(() => {
  'use strict';

  const Native = window.SpotifyAltNative || null;
  const $ = (id) => document.getElementById(id);

  const state = {
    player: null,
    sdkLoading: false,
    sdkReady: false,
    deviceId: null,
    currentUri: null,
    liked: false,
    playing: false,
    positionMs: 0,
    durationMs: 0,
    positionUpdatedAt: performance.now(),
    artUrl: '',
    title: 'Nothing playing',
    artist: 'Choose something to play',
    mediaBridgeStarted: false,
  };

  const els = {};

  function cacheElements() {
    [
      'runtime', 'status', 'setupCard', 'playerCard', 'searchCard', 'diagnosticsCard',
      'clientId', 'connectButton', 'artwork', 'artPlaceholder', 'trackTitle',
      'trackArtist', 'heartButton', 'previousButton', 'toggleButton', 'nextButton',
      'progress', 'elapsed', 'duration', 'playHereButton', 'searchInput',
      'searchButton', 'searchResults', 'webViewVersion', 'sdkStatus', 'deviceStatus'
    ].forEach((id) => { els[id] = $(id); });
  }

  function setStatus(text, kind = 'ok') {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.className = `status${kind === 'ok' ? '' : ` ${kind}`}`;
  }

  function connected() {
    if (!Native) return false;
    try { return Native.status() === 'Spotify connected'; } catch (_) { return false; }
  }

  function accessToken() {
    if (!Native) return '';
    try { return Native.accessToken() || ''; } catch (_) { return ''; }
  }

  async function spotifyFetch(path, options = {}) {
    const token = accessToken();
    if (!token) throw new Error('Spotify authorization is missing or expired.');

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const response = await fetch(`https://api.spotify.com/v1${path}`, { ...options, headers });
    if (response.status === 204) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Spotify API ${response.status}${text ? `: ${text.slice(0, 180)}` : ''}`);
    }
    const type = response.headers.get('content-type') || '';
    return type.includes('application/json') ? response.json() : response.text();
  }

  function loadSdk() {
    if (state.sdkLoading || state.sdkReady || !connected()) return;
    state.sdkLoading = true;
    els.sdkStatus.textContent = 'loading';
    setStatus('Loading Spotify Web Playback SDK…');

    window.onSpotifyWebPlaybackSDKReady = createPlayer;

    const existing = document.querySelector('script[data-spotify-sdk]');
    if (existing) {
      if (window.Spotify) createPlayer();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.dataset.spotifySdk = 'true';
    script.onerror = () => {
      state.sdkLoading = false;
      els.sdkStatus.textContent = 'failed to load';
      setStatus('Spotify SDK could not be downloaded. Check the connection and WebView network access.', 'error');
    };
    document.head.appendChild(script);
  }

  function createPlayer() {
    if (state.player || !window.Spotify) return;

    const player = new window.Spotify.Player({
      name: 'SpotifyAlt',
      getOAuthToken: (callback) => {
        const token = accessToken();
        if (!token) {
          setStatus('Spotify token unavailable. Reconnect Spotify.', 'error');
          callback('');
          return;
        }
        callback(token);
      },
      volume: 1.0,
      enableMediaSession: false,
    });

    state.player = player;

    player.addListener('ready', ({ device_id }) => {
      state.sdkReady = true;
      state.sdkLoading = false;
      state.deviceId = device_id;
      els.sdkStatus.textContent = 'ready';
      els.deviceStatus.textContent = device_id;
      els.playHereButton.disabled = false;
      enableControls(true);
      startNativeMediaBridge();
      setStatus('SpotifyAlt is online as a Spotify Connect device. Tap “Play here” to move playback into SpotifyAlt.');
    });

    player.addListener('not_ready', ({ device_id }) => {
      state.sdkReady = false;
      els.sdkStatus.textContent = 'offline';
      els.deviceStatus.textContent = device_id || 'offline';
      setStatus('SpotifyAlt playback device went offline.', 'warn');
    });

    player.addListener('player_state_changed', (playerState) => {
      if (!playerState) return;
      applyPlayerState(playerState);
    });

    player.addListener('initialization_error', ({ message }) => {
      els.sdkStatus.textContent = 'initialization error';
      setStatus(`Web Playback could not initialize in this WebView: ${message}`, 'error');
    });

    player.addListener('authentication_error', ({ message }) => {
      els.sdkStatus.textContent = 'authentication error';
      setStatus(`Spotify authentication error: ${message}. Reconnect SpotifyAlt.`, 'error');
    });

    player.addListener('account_error', ({ message }) => {
      els.sdkStatus.textContent = 'account error';
      setStatus(`Spotify account cannot use Web Playback: ${message}`, 'error');
    });

    player.addListener('playback_error', ({ message }) => {
      setStatus(`Playback error: ${message}`, 'error');
    });

    player.addListener('autoplay_failed', () => {
      setStatus('Android blocked automatic playback. Tap “Play here” again to activate audio.', 'warn');
    });

    player.connect().then((ok) => {
      if (!ok) {
        state.sdkLoading = false;
        els.sdkStatus.textContent = 'connect failed';
        setStatus('Spotify Web Playback SDK loaded, but the player could not connect.', 'error');
      }
    }).catch((error) => {
      state.sdkLoading = false;
      els.sdkStatus.textContent = 'connect failed';
      setStatus(`Spotify player connection failed: ${error.message || error}`, 'error');
    });
  }

  function applyPlayerState(playerState) {
    const track = playerState.track_window?.current_track;
    if (!track) return;

    state.currentUri = track.uri || null;
    state.title = track.name || 'Unknown track';
    state.artist = (track.artists || []).map((artist) => artist.name).filter(Boolean).join(', ') || 'Unknown artist';
    state.artUrl = track.album?.images?.[0]?.url || '';
    state.playing = !playerState.paused;
    state.positionMs = playerState.position || 0;
    state.durationMs = playerState.duration || track.duration_ms || 0;
    state.positionUpdatedAt = performance.now();

    els.trackTitle.textContent = state.title;
    els.trackArtist.textContent = state.artist;
    els.toggleButton.textContent = state.playing ? 'Ⅱ' : '▶';
    els.progress.max = Math.max(1, state.durationMs);
    els.progress.value = state.positionMs;
    els.duration.textContent = formatTime(state.durationMs);

    if (state.artUrl) {
      els.artwork.src = state.artUrl;
      els.artwork.classList.remove('hidden');
      els.artPlaceholder.classList.add('hidden');
    } else {
      els.artwork.classList.add('hidden');
      els.artPlaceholder.classList.remove('hidden');
    }

    syncLiked(state.currentUri);
  }

  function syncLiked(uri) {
    if (!uri || !Native) return;
    Promise.resolve().then(() => {
      try {
        const saved = !!Native.isSaved(uri);
        if (state.currentUri !== uri) return;
        state.liked = saved;
        renderLiked();
        publishNativeState();
      } catch (error) {
        console.warn('Liked Songs lookup failed', error);
        publishNativeState();
      }
    });
  }

  async function toggleLike() {
    const uri = state.currentUri;
    if (!uri || !Native) return;
    const target = !state.liked;
    els.heartButton.disabled = true;
    try {
      const ok = !!Native.setSaved(uri, target);
      if (!ok) throw new Error('Spotify did not accept the library change.');
      if (state.currentUri === uri) {
        state.liked = target;
        renderLiked();
        publishNativeState();
      }
    } catch (error) {
      setStatus(`Liked Songs update failed: ${error.message || error}`, 'error');
    } finally {
      els.heartButton.disabled = false;
    }
  }

  function renderLiked() {
    els.heartButton.textContent = state.liked ? '♥' : '♡';
    els.heartButton.classList.toggle('liked', state.liked);
    els.heartButton.setAttribute('aria-label', state.liked ? 'Remove from Liked Songs' : 'Add to Liked Songs');
  }

  function startNativeMediaBridge() {
    if (!Native || state.mediaBridgeStarted) return;
    try {
      Native.startMediaBridge();
      state.mediaBridgeStarted = true;
      setTimeout(publishNativeState, 100);
    } catch (error) {
      console.warn('Native media bridge failed to start', error);
    }
  }

  function publishNativeState() {
    if (!Native || !state.mediaBridgeStarted) return;
    try {
      Native.updateMediaState(JSON.stringify({
        title: state.title,
        artist: state.artist,
        uri: state.currentUri || '',
        artUrl: state.artUrl || '',
        liked: state.liked,
        playing: state.playing,
        positionMs: Math.round(currentPosition()),
        durationMs: state.durationMs,
      }));
    } catch (error) {
      console.warn('Native media state update failed', error);
    }
  }

  async function transferHere(play = true) {
    if (!state.deviceId || !state.player) return;
    try {
      await state.player.activateElement();
      await spotifyFetch('/me/player', {
        method: 'PUT',
        body: JSON.stringify({ device_ids: [state.deviceId], play }),
      });
      setStatus('Playback transferred to SpotifyAlt.');
    } catch (error) {
      setStatus(`Could not transfer playback: ${error.message || error}`, 'error');
    }
  }

  async function playUri(uri) {
    if (!state.deviceId) {
      setStatus('SpotifyAlt player is not ready yet.', 'warn');
      return;
    }
    try {
      await state.player.activateElement();
      await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(state.deviceId)}`, {
        method: 'PUT',
        body: JSON.stringify({ uris: [uri] }),
      });
      setStatus('Playing in SpotifyAlt.');
    } catch (error) {
      setStatus(`Could not start track: ${error.message || error}`, 'error');
    }
  }

  async function searchTracks() {
    const query = els.searchInput.value.trim();
    if (!query) return;
    els.searchButton.disabled = true;
    els.searchResults.innerHTML = '<p class="muted">Searching…</p>';
    try {
      const data = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=track&limit=10`);
      const tracks = data?.tracks?.items || [];
      renderSearchResults(tracks);
    } catch (error) {
      els.searchResults.innerHTML = '';
      setStatus(`Search failed: ${error.message || error}`, 'error');
    } finally {
      els.searchButton.disabled = false;
    }
  }

  function renderSearchResults(tracks) {
    els.searchResults.innerHTML = '';
    if (!tracks.length) {
      els.searchResults.innerHTML = '<p class="muted">No tracks found.</p>';
      return;
    }

    tracks.forEach((track) => {
      const button = document.createElement('button');
      button.className = 'search-result';
      const image = track.album?.images?.[track.album.images.length - 1]?.url || track.album?.images?.[0]?.url || '';
      const artists = (track.artists || []).map((artist) => artist.name).join(', ');
      button.innerHTML = `
        ${image ? `<img src="${escapeAttribute(image)}" alt="">` : '<span></span>'}
        <span><span class="search-result-title">${escapeHtml(track.name || 'Unknown')}</span><span class="search-result-artist">${escapeHtml(artists)}</span></span>
        <span class="search-play">▶</span>`;
      button.addEventListener('click', () => playUri(track.uri));
      els.searchResults.appendChild(button);
    });
  }

  function enableControls(enabled) {
    [els.previousButton, els.toggleButton, els.nextButton].forEach((button) => { button.disabled = !enabled; });
  }

  function currentPosition() {
    if (!state.playing) return state.positionMs;
    return Math.min(state.durationMs || Infinity, state.positionMs + (performance.now() - state.positionUpdatedAt));
  }

  function updateProgressClock() {
    if (!els.progress || document.activeElement === els.progress) return;
    const pos = currentPosition();
    els.progress.value = Math.round(pos || 0);
    els.elapsed.textContent = formatTime(pos || 0);
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function bindEvents() {
    els.connectButton.addEventListener('click', () => {
      const id = els.clientId.value.trim();
      if (!id) {
        setStatus('Enter your Spotify Client ID first.', 'warn');
        return;
      }
      if (!Native) {
        setStatus('This alpha currently performs OAuth through the SpotifyAlt Android shell.', 'warn');
        return;
      }
      localStorage.setItem('spotifyalt.clientId', id);
      Native.connectSpotify(id);
    });

    els.playHereButton.addEventListener('click', () => transferHere(true));
    els.heartButton.addEventListener('click', toggleLike);
    els.previousButton.addEventListener('click', () => state.player?.previousTrack());
    els.toggleButton.addEventListener('click', async () => {
      if (!state.player) return;
      await state.player.activateElement().catch(() => {});
      state.player.togglePlay();
    });
    els.nextButton.addEventListener('click', () => state.player?.nextTrack());

    els.progress.addEventListener('change', () => {
      const value = Number(els.progress.value || 0);
      state.player?.seek(value);
    });

    els.searchButton.addEventListener('click', searchTracks);
    els.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') searchTracks();
    });
  }

  function nativeCommand(command) {
    if (!command) return;
    if (command === 'previous') return state.player?.previousTrack();
    if (command === 'next') return state.player?.nextTrack();
    if (command === 'play') return state.player?.resume();
    if (command === 'pause') return state.player?.pause();
    if (command.startsWith('seek:')) return state.player?.seek(Number(command.slice(5)) || 0);
    if (command.startsWith('liked:')) {
      state.liked = command.slice(6) === 'true';
      renderLiked();
      return;
    }
  }

  function onNativeResume() {
    setTimeout(() => {
      if (connected()) {
        els.setupCard.classList.add('hidden');
        els.playerCard.classList.remove('hidden');
        els.searchCard.classList.remove('hidden');
        loadSdk();
      }
    }, 100);
  }

  function boot() {
    cacheElements();
    bindEvents();
    enableControls(false);
    setInterval(updateProgressClock, 500);

    const savedClientId = localStorage.getItem('spotifyalt.clientId') || '';
    els.clientId.value = savedClientId;

    if (Native) {
      els.runtime.textContent = Native.runtime();
      els.webViewVersion.textContent = Native.webViewVersion();
      els.diagnosticsCard.classList.remove('hidden');
      if (connected()) {
        els.setupCard.classList.add('hidden');
        els.playerCard.classList.remove('hidden');
        els.searchCard.classList.remove('hidden');
        setStatus('Spotify connected. Preparing web player…');
        loadSdk();
      } else {
        setStatus('Connect Spotify to create the SpotifyAlt playback device.');
      }
    } else {
      els.runtime.textContent = 'browser/PWA';
      setStatus('PWA shell loaded. Android-native OAuth/media integration is unavailable in this build.', 'warn');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  window.SpotifyAltApp = {
    setStatus,
    nativeCommand,
    onNativeResume,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
