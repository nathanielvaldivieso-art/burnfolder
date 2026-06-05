/**
 * Lock-screen / Control Center metadata and transport for Mux audio playback.
 */
(function (root) {
  'use strict';

  function defaultArtworkForPlaybackId(playbackId) {
    if (!playbackId) return [];
    const url = 'https://image.mux.com/' + playbackId + '/thumbnail.webp?time=1';
    return [
      { src: url, sizes: '96x96', type: 'image/webp' },
      { src: url, sizes: '128x128', type: 'image/webp' },
      { src: url, sizes: '256x256', type: 'image/webp' },
      { src: url, sizes: '512x512', type: 'image/webp' }
    ];
  }

  function artworkForSong(song, opts) {
    const options = opts || {};
    if (typeof options.artworkForSong === 'function') {
      const custom = options.artworkForSong(song);
      if (custom && custom.length) return custom;
    }
    if (song && song.artwork && song.artwork.length) return song.artwork;
    if (song && song.coverArt) {
      return [{ src: String(song.coverArt), sizes: '512x512', type: 'image/jpeg' }];
    }
    return defaultArtworkForPlaybackId(song && song.playbackId);
  }

  function supported() {
    return !!(root.navigator && root.navigator.mediaSession);
  }

  function setMetadata(song, detail, opts) {
    if (!supported() || !song) return;
    const options = opts || {};
    const title = String(song.title || song.displayTitle || 'untitled').trim();
    try {
      root.navigator.mediaSession.metadata = new root.MediaMetadata({
        title: title,
        artist: String(options.artist || 'burnfolder').trim(),
        album: String(options.album || 'stream').trim(),
        artwork: artworkForSong(song, options)
      });
    } catch (e) {
      /* older browsers */
    }
    setPlaybackState(detail && detail.playing);
  }

  function setPlaybackState(playing) {
    if (!supported()) return;
    try {
      root.navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch (e) {
      /* noop */
    }
  }

  function setPositionState(player) {
    if (!supported() || !player) return;
    if (typeof root.navigator.mediaSession.setPositionState !== 'function') return;
    const duration = Number(player.duration);
    const position = Number(player.currentTime);
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (!Number.isFinite(position) || position < 0) return;
    try {
      root.navigator.mediaSession.setPositionState({
        duration: duration,
        playbackRate: player.playbackRate || 1,
        position: Math.min(position, duration)
      });
    } catch (e) {
      /* noop */
    }
  }

  function bindActions(handlers) {
    if (!supported()) return;
    const map = handlers || {};
    const actions = [
      'play',
      'pause',
      'previoustrack',
      'nexttrack',
      'seekbackward',
      'seekforward',
      'stop'
    ];
    actions.forEach(function (action) {
      try {
        if (typeof map[action] === 'function') {
          root.navigator.mediaSession.setActionHandler(action, map[action]);
        } else {
          root.navigator.mediaSession.setActionHandler(action, null);
        }
      } catch (e) {
        /* unsupported action on this platform */
      }
    });
  }

  root.BurnfolderMediaSession = {
    supported: supported,
    setMetadata: setMetadata,
    setPlaybackState: setPlaybackState,
    setPositionState: setPositionState,
    bindActions: bindActions,
    defaultArtworkForPlaybackId: defaultArtworkForPlaybackId,
    artworkForSong: artworkForSong
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
