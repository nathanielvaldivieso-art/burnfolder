(function () {
  'use strict';

  const playback = window.BurnfolderMuxPlayback
    ? window.BurnfolderMuxPlayback.create({
        playerId: 'activeMuxPlayer',
        onStateChange: function (detail) {
          window.dispatchEvent(
            new CustomEvent('burnfolder-stream-playback', { detail: detail })
          );
        }
      })
    : null;

  function songFromItem(item) {
    if (!item || !item.playbackId) return null;
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
      muxAssetId: item.muxAssetId
    };
  }

  function playItem(item) {
    const song = songFromItem(item);
    if (!song || song.kind === 'video') return false;
    if (!playback) return false;
    return playback.playTrackQueue([song], 0);
  }

  function playQueue(items, startIdx) {
    const songs = (items || [])
      .map(songFromItem)
      .filter(function (s) {
        return s && s.playbackId && s.kind !== 'video';
      });
    if (!songs.length || !playback) return false;
    return playback.playTrackQueue(songs, startIdx || 0);
  }

  window.BurnfolderStreamPlayer = {
    playItem: playItem,
    playQueue: playQueue,
    togglePause: function () {
      if (playback) playback.togglePlayPause();
    },
    stop: function () {
      if (playback) playback.stop();
    },
    isPlayingPlaybackId: function (id) {
      return playback ? playback.isPlayingPlaybackId(id) : false;
    },
    isActivePlaybackId: function (id) {
      return playback ? playback.isActivePlaybackId(id) : false;
    },
    getActiveSong: function () {
      return playback ? playback.getActiveSong() : null;
    },
    /** Same engine the main site uses (for stack / advanced use). */
    engine: playback
  };
})();
