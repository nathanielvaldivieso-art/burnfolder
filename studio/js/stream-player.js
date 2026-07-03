(function () {
  'use strict';

  let localPlayback = null;

  function getLocalPlayback() {
    if (localPlayback) return localPlayback;
    if (!window.BurnfolderMuxPlayback) return null;
    localPlayback = window.BurnfolderMuxPlayback.create({
      playerId: 'activeMuxPlayer',
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
    return getLocalPlayback();
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

  function playbackOptsForSong(song, opts) {
    const options = opts || {};
    const intentApi = window.BurnfolderPlaybackIntent;
    if (!intentApi || !song) {
      return Object.assign({ immediatePlay: true }, options);
    }
    if (options.queueScope || options.scope) {
      return Object.assign({ immediatePlay: true }, options);
    }
    if (options.queueScope === 'album' || options.albumTitle) {
      return Object.assign(
        {
          immediatePlay: true,
          queueScope: 'album',
          albumTitle: options.albumTitle || song.album || '',
          allowQueueAdvance: true,
          source: 'studio-album'
        },
        options
      );
    }
    if (options.queueScope === 'song-hub' || options.groupKey) {
      return Object.assign(
        {
          immediatePlay: true,
          queueScope: 'song-hub',
          groupKey: options.groupKey || '',
          allowQueueAdvance: true,
          source: 'studio-song-hub'
        },
        options
      );
    }
  return Object.assign(
      {
        immediatePlay: true,
        queueScope: 'single',
        source: 'studio-row'
      },
      options
    );
  }

  function playItem(item, opts) {
    const song = songFromItem(item, opts);
    const playback = engine();
    if (!song || song.kind === 'video' || !playback) return false;
    if (window.BurnfolderStudioPlaybackShell) window.BurnfolderStudioPlaybackShell.mountBar();
    return playback.playTrackQueue([song], 0, playbackOptsForSong(song, opts));
  }

  function playQueue(items, startIdx, opts) {
    const options = opts || {};
    const songs = (items || [])
      .map(function (item) {
        return songFromItem(item, options);
      })
      .filter(function (s) {
        return s && s.playbackId && s.kind !== 'video';
      });
    const playback = engine();
    if (!songs.length || !playback) return false;
    if (window.BurnfolderStudioPlaybackShell) window.BurnfolderStudioPlaybackShell.mountBar();
    const queueOpts = playbackOptsForSong(songs[startIdx || 0], options);
    if (songs.length > 1) {
      queueOpts.queueScope = queueOpts.queueScope === 'single' ? 'explicit' : queueOpts.queueScope;
      queueOpts.allowQueueAdvance = true;
      queueOpts.source = queueOpts.source || 'studio-queue';
    }
    return playback.playTrackQueue(songs, startIdx || 0, queueOpts);
  }

  function primeItem(item) {
    const song = songFromItem(item);
    const playback = engine();
    if (!song || song.kind === 'video' || !playback || !playback.primeTrack) return false;
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
