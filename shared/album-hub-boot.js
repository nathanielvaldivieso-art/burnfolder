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
      (global.BurnfolderAlbumHubRender || global.BurnfolderAlbumPageRender)
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
    const newRenderApi = global.BurnfolderAlbumHubRender;
    const fallbackRenderApi = global.BurnfolderAlbumPageRender;
    if (!hubRoot || (!newRenderApi && !fallbackRenderApi)) return false;

    const albumId = albumIdFromLocation();
    const published = (global.burnfolderAlbumPages || {})[albumId];

    if (!albumId || !published) {
      hubRoot.innerHTML = '<p class="page-annotation">Album not found.</p>';
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

    if (newRenderApi) {
      newRenderApi.apply(hubRoot, {
        albumPage: published,
        tracks: tracks,
        songPages: songPages,
        songCatalog: catalog,
        versionsApi: sv,
        songPageUrl: function (item) {
          return sv && sv.getSongHubHref ? sv.getSongHubHref(item, '') : '';
        }
      });
    } else {
      fallbackRenderApi.apply(hubRoot, {
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
        songPageUrl: function (item) {
          return sv && sv.getSongHubHref ? sv.getSongHubHref(item, '') : '';
        },
        showSongLinks: true,
        onTrackSelect: function () {
          if (typeof global.__albumHubPlayTrack === 'function') {
            global.__albumHubPlayTrack.apply(null, arguments);
          }
        }
      });
    }

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
