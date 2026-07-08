(function () {
  'use strict';

  let localPlayback = null;

  function createLocalPlayback() {
    if (localPlayback || !window.BurnfolderMuxPlayback) return localPlayback;
    localPlayback = window.BurnfolderMuxPlayback.create({
      getPlayer: function () {
        const shell = window.BurnfolderStudioPlaybackShell;
        if (shell && typeof shell.ensureShell === 'function') {
          shell.ensureShell();
          const shellNode = document.getElementById('studioGlobalPlayback');
          if (shellNode) {
            const player = shellNode.querySelector('#activeMuxPlayer');
            if (player) return player;
          }
        }
        return document.getElementById('activeMuxPlayer');
      },
      recall: true,
      restoreRecall: false,
      artist: 'burnfolder',
      album: 'stream',
      onPlayBlocked: function (player) {
        if (player) player.play().catch(function () {});
      },
      onStateChange: function (detail) {
        window.dispatchEvent(new CustomEvent('burnfolder-stream-playback', { detail: detail }));
      }
    });
    return localPlayback;
  }

  function engine() {
    const shell = window.BurnfolderStudioPlaybackShell;
    if (shell && typeof shell.getEngine === 'function') {
      const shared = shell.getEngine();
      if (shared) return shared;
    }
    return createLocalPlayback();
  }

  function songFromItem(item, opts) {
    if (!item || !item.playbackId) return null;
    const options = opts || {};
    const sv = window.BurnfolderSongVersions;
    const mux = window.BurnfolderStudioMux;
    let label =
      mux && mux.muxFileLabel ? mux.muxFileLabel(item) : item.muxCanonicalTitle || item.passthrough || 'untitled';
    if (sv) {
      const catalog = sv.mergeSongCatalog
        ? sv.mergeSongCatalog(sv.getSiteCatalog(window), [item], function (row) {
            return label;
          })
        : window.allSongs || [];
      label = sv.titleFromCatalog(catalog, item.playbackId, label);
    }
    return {
      title: label,
      playbackId: item.playbackId,
      kind: item.kind || 'audio',
      muxAssetId: item.muxAssetId,
      coverArt: item.coverArt || options.coverArt || null
    };
  }

  function preparePlayback() {
    const shell = window.BurnfolderStudioPlaybackShell;
    if (shell) {
      if (shell.ensureShell) shell.ensureShell();
      if (shell.mountBar) shell.mountBar();
      const node = document.getElementById('studioGlobalPlayback');
      const mux = node && node.querySelector('#activeMuxPlayer');
      if (mux && !mux.isConnected) shell.ensureShell();
      if (shell.getEngine) return shell.getEngine();
    }
    return engine();
  }

  function playItem(item, opts) {
    const song = songFromItem(item, opts);
    const playback = preparePlayback();
    if (!song || song.kind === 'video' || !playback) return false;
    return playback.playTrackQueue([song], 0, { immediatePlay: true });
  }

  function resolveQueueStart(songs, rawMapped, startIdx, startPlaybackId) {
    if (startPlaybackId) {
      const byId = songs.findIndex(function (s) {
        return s.playbackId === startPlaybackId;
      });
      if (byId >= 0) return byId;
    }

    const rawIndex = typeof startIdx === 'number' && startIdx >= 0 ? startIdx : 0;
    const want = rawMapped[rawIndex];
    if (want && want.playbackId) {
      const byWant = songs.findIndex(function (s) {
        return s.playbackId === want.playbackId;
      });
      if (byWant >= 0) return byWant;
    }

    // Video (or missing) at the requested slot — start at the next playable track.
    for (let r = rawIndex; r < rawMapped.length; r++) {
      const id = rawMapped[r] && rawMapped[r].playbackId;
      if (!id) continue;
      const j = songs.findIndex(function (s) {
        return s.playbackId === id;
      });
      if (j >= 0) return j;
    }
    return 0;
  }

  function playQueue(items, startIdx, opts) {
    const options = opts || {};
    const rawItems = items || [];
    const rawMapped = rawItems.map(function (item) {
      return songFromItem(item, options) || {
        playbackId: item && item.playbackId,
        kind: item && item.kind
      };
    });
    const songs = rawMapped.filter(function (s) {
      return s && s.playbackId && s.kind !== 'video';
    });
    const playback = preparePlayback();
    if (!songs.length || !playback) return false;
    // Prefer identity over list index: after videos are filtered out, a raw
    // DOM/group index no longer matches the playable queue.
    const remapped = resolveQueueStart(
      songs,
      rawMapped,
      startIdx,
      options.startPlaybackId || ''
    );
    return playback.playTrackQueue(songs, remapped, { immediatePlay: true });
  }

  function primeItem(item) {
    const song = songFromItem(item);
    if (!song || song.kind === 'video') return false;
    // Never rewrite the live #activeMuxPlayer on touch-down — that caused
    // intermittent "tapped X, heard Y" on mobile. Warm the prefetch pool only.
    if (window.BurnfolderPlaybackPrefetch && window.BurnfolderPlaybackPrefetch.prefetch) {
      window.BurnfolderPlaybackPrefetch.prefetch(song.playbackId);
      if (song.coverArt && window.BurnfolderPlaybackPrefetch.warmArtwork) {
        window.BurnfolderPlaybackPrefetch.warmArtwork(song.playbackId, song.coverArt);
      }
      return true;
    }
    const playback = preparePlayback();
    if (!playback || !playback.primeTrack) return false;
    return playback.primeTrack(song);
  }

  window.BurnfolderStreamPlayer = {
    playItem: playItem,
    playQueue: playQueue,
    primeItem: primeItem,
    togglePause: function () {
      const playback = engine();
      if (playback) playback.togglePlayPause();
    },
    stop: function () {
      const playback = engine();
      if (playback) playback.stop();
    },
    isPlayingPlaybackId: function (id) {
      const playback = engine();
      return playback ? playback.isPlayingPlaybackId(id) : false;
    },
    isActivePlaybackId: function (id) {
      const playback = engine();
      return playback ? playback.isActivePlaybackId(id) : false;
    },
    getActiveSong: function () {
      const playback = engine();
      return playback ? playback.getActiveSong() : null;
    },
    engine: function () {
      return engine();
    }
  };
})();
