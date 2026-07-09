/**
 * Album hub: render as soon as album-pages + render API are ready — do not wait
 * for songs.js / scripts.js (large sync chain that blocked first paint).
 */
(function (global) {
  'use strict';

  function albumIdFromLocation() {
    return (new URLSearchParams(global.location.search).get('album') || '').trim();
  }

  function dependenciesReady() {
    return !!(
      global.document.getElementById('albumHubPage') &&
      global.burnfolderAlbumPages &&
      global.BurnfolderAlbumPageRender
    );
  }

  function buildTracks(published) {
    const allSongs = Array.isArray(global.allSongs) ? global.allSongs : [];
    return (published.tracks || [])
      .map(function (ref) {
        const hit = allSongs.find(function (song) {
          return song && song.playbackId === ref.playbackId;
        });
        if (hit) {
          return Object.assign({}, hit, {
            title: String(ref.title || '').trim() || hit.title
          });
        }
        return { title: ref.title || 'untitled', playbackId: ref.playbackId };
      })
      .filter(function (track) {
        return track.playbackId;
      });
  }

  function renderAlbumHubEarly() {
    const hubRoot = global.document.getElementById('albumHubPage');
    const renderApi = global.BurnfolderAlbumPageRender;
    if (!hubRoot || !renderApi) return false;

    const albumId = albumIdFromLocation();
    const published = (global.burnfolderAlbumPages || {})[albumId];
    const titleEl = hubRoot.querySelector('[data-album-field="title"]');
    const subtitleEl = hubRoot.querySelector('[data-album-field="subtitle"]');

    if (!albumId || !published) {
      if (titleEl) titleEl.textContent = 'Album';
      if (subtitleEl) subtitleEl.textContent = 'Album not found.';
      return false;
    }

    const sv = global.BurnfolderSongVersions;
    const allSongs = Array.isArray(global.allSongs) ? global.allSongs : [];
    const catalog =
      sv && sv.mergeSongCatalog ? sv.mergeSongCatalog(allSongs, []) : allSongs;
    const songPages = global.burnfolderSongPages || {};
    const tracks = buildTracks(published);

    if (tracks.length) {
      global.currentSongs = tracks.slice();
    }

    renderApi.apply(hubRoot, {
      albumPage: published,
      meta: {
        title: published.title || 'Album',
        coverArt: published.coverArt || '',
        tagline: published.subtitle || ''
      },
      tracks: tracks,
      songPages: songPages,
      songCatalog: catalog,
      versionsApi: sv,
      itemLabel: function (item) {
        return (item && item.title) || 'untitled';
      },
      showSongLinks: false,
      onTrackSelect: function () {
        if (typeof global.__albumHubPlayTrack === 'function') {
          global.__albumHubPlayTrack.apply(null, arguments);
        }
      },
      onRendered: function () {
        const tagline = String(published.subtitle || '').trim();
        const metaEl = hubRoot.querySelector('[data-album-field="track-meta"]');
        if (tagline && subtitleEl) {
          subtitleEl.textContent = tagline;
        }
        if (metaEl && renderApi.compileTrackRows) {
          const summaryRows = renderApi.compileTrackRows({
            tracks: tracks,
            songPages: songPages,
            songCatalog: catalog,
            versionsApi: sv,
            itemLabel: function (item) {
              return (item && item.title) || 'untitled';
            }
          });
          const shared = global.BurnfolderStreamShared;
          const items = summaryRows.map(function (row) {
            return {
              playbackId: row.playbackId,
              duration: row.item && row.item.duration
            };
          });
          let metaText = '';
          if (shared && shared.sumTrackDurations && shared.albumTrackCountMeta) {
            const sum = shared.sumTrackDurations(items);
            metaText = shared.albumTrackCountMeta(
              items.length,
              sum.complete ? sum.total : 0
            );
          } else if (items.length) {
            metaText = items.length + ' track' + (items.length === 1 ? '' : 's');
          }
          if (metaText) {
            metaEl.textContent = metaText;
            metaEl.hidden = false;
          }
        }
      }
    });

    if (published.title) {
      global.document.title = published.title + ' — burnfolder.com';
    }

    global.__albumHubEarlyRendered = albumId;
    return true;
  }

  function boot(attempt) {
    if (!dependenciesReady()) {
      if (attempt < 80) {
        global.setTimeout(function () {
          boot(attempt + 1);
        }, 25);
      }
      return;
    }
    if (renderAlbumHubEarly()) return;
    if (attempt < 80) {
      global.setTimeout(function () {
        boot(attempt + 1);
      }, 25);
    }
  }

  function scheduleBoot() {
    boot(0);
  }

  global.BurnfolderAlbumHubBoot = {
    render: renderAlbumHubEarly,
    schedule: scheduleBoot
  };

  global.addEventListener('pageshow', scheduleBoot);
  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', scheduleBoot);
  } else {
    scheduleBoot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
