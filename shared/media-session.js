/**
 * Lock-screen / Control Center metadata and transport for Mux audio playback.
 */
(function (root) {
  'use strict';

  const ARTWORK_SIZES = [96, 128, 256, 512];

  function resolveArtworkUrl(src) {
    const raw = String(src || '').trim();
    if (!raw) return '';
    if (/^(data:|blob:|https?:)/i.test(raw)) return raw;
    try {
      return new URL(raw, root.location.href).href;
    } catch (e) {
      return raw;
    }
  }

  function mimeFromUrl(url) {
    const u = String(url || '').toLowerCase();
    if (u.startsWith('data:image/png')) return 'image/png';
    if (u.startsWith('data:image/webp')) return 'image/webp';
    if (u.startsWith('data:image/gif')) return 'image/gif';
    if (u.includes('.png')) return 'image/png';
    if (u.includes('.webp')) return 'image/webp';
    if (u.includes('.gif')) return 'image/gif';
    return 'image/jpeg';
  }

  function artworkEntry(src, size) {
    const url = resolveArtworkUrl(src);
    if (!url) return null;
    const px = String(size);
    return { src: url, sizes: px + 'x' + px, type: mimeFromUrl(url) };
  }

  function artworkFromSrc(src) {
    const url = resolveArtworkUrl(src);
    if (!url) return [];
    return ARTWORK_SIZES.map(function (size) {
      return artworkEntry(url, size);
    }).filter(Boolean);
  }

  function defaultArtworkForPlaybackId(playbackId) {
    if (!playbackId) return [];
    return ARTWORK_SIZES.map(function (width) {
      const url =
        'https://image.mux.com/' +
        playbackId +
        '/thumbnail.jpg?time=1&width=' +
        width;
      return { src: url, sizes: width + 'x' + width, type: 'image/jpeg' };
    });
  }

  function artworkForSong(song, opts) {
    const options = opts || {};
    if (song && song.coverArt) {
      const cover = artworkFromSrc(song.coverArt);
      if (cover.length) return cover;
    }
    if (typeof options.artworkForSong === 'function') {
      const custom = options.artworkForSong(song);
      if (custom && custom.length) return custom;
    }
    if (song && song.artwork && song.artwork.length) return song.artwork;
    return defaultArtworkForPlaybackId(song && song.playbackId);
  }

  function supported() {
    return !!(root.navigator && root.navigator.mediaSession);
  }

  function applyMetadata(song, detail, artwork, options) {
    const title = String(song.title || song.displayTitle || 'untitled').trim();
    root.navigator.mediaSession.metadata = new root.MediaMetadata({
      title: title,
      artist: String(options.artist || song.artist || 'burnfolder').trim(),
      album: String(options.album || song.album || 'stream').trim(),
      artwork: artwork
    });
    setPlaybackState(detail && detail.playing);
  }

  function setMetadata(song, detail, opts) {
    if (!supported() || !song) return;
    const options = opts || {};
    const artwork = artworkForSong(song, options);
    try {
      applyMetadata(song, detail, artwork, options);
    } catch (e) {
      /* older browsers */
      return;
    }

    if (!artwork.length) return;
    const preferred =
      artwork.find(function (entry) {
        return entry.sizes === '512x512';
      }) || artwork[artwork.length - 1];
    const img = new root.Image();
    img.onload = function () {
      try {
        applyMetadata(song, detail, artwork, options);
      } catch (e) {
        /* noop */
      }
    };
    img.src = preferred.src;
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
    artworkForSong: artworkForSong,
    resolveArtworkUrl: resolveArtworkUrl
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
