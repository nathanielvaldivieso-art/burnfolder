/**
 * Bottom now-playing bar: progress, play/pause, version picker (burnfolder.com parity).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BurnfolderNowPlayingBar = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const globalRef =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
        ? window
        : this;

  function mount(options) {
    const opts = options || {};
    const bar = opts.barEl || document.getElementById('bottomBar');
    const titleEl = opts.titleEl || document.getElementById('songTitle') || document.getElementById('streamNowPlayingTitle');
    const playBtn = opts.playBtnEl || document.getElementById('bottomPlayPause') || document.getElementById('streamPlayPause');
    const closeBtn = opts.closeBtnEl || document.getElementById('closeBtn') || document.getElementById('streamNowPlayingClose');
    const progressBarArea = opts.progressEl || document.getElementById('progressBarArea');
    const progressFill = document.getElementById('progress');
    const playheadEl = document.getElementById('progressPlayhead');
    const spinner = document.getElementById('loadingSpinner');
    const muxPlayer =
      opts.muxPlayerEl || document.getElementById('activeMuxPlayer');

    if (!bar || !titleEl) return null;

    const ctx = globalRef.BurnfolderPlaybackContext;
    const picker = globalRef.BurnfolderVersionPicker;
    let pickerApi = null;
    let extraSongs = [];

    function getActiveSong() {
      if (typeof opts.getActiveSong === 'function') return opts.getActiveSong();
      return null;
    }

    function setBarVisible(show) {
      bar.style.display = show ? 'block' : 'none';
      const bodyClass = opts.bodyActiveClass || 'stream-playback-active';
      if (bodyClass) document.body.classList.toggle(bodyClass, !!show);
      if (!show && pickerApi) pickerApi.close();
    }

    function updateProgress() {
      if (!muxPlayer || !progressFill || !muxPlayer.duration || Number.isNaN(muxPlayer.duration)) return;
      const pct = Math.min(100, Math.max(0, (muxPlayer.currentTime / muxPlayer.duration) * 100));
      progressFill.style.width = pct + '%';
      if (playheadEl) playheadEl.style.left = pct + '%';
    }

    function seekToRatio(ratio) {
      if (!muxPlayer || !muxPlayer.duration || Number.isNaN(muxPlayer.duration)) return;
      const r = Math.min(1, Math.max(0, ratio));
      muxPlayer.currentTime = r * muxPlayer.duration;
      updateProgress();
    }

    function titleForSong(song) {
      if (ctx && ctx.displayTitleForPlayback) {
        return ctx.displayTitleForPlayback(song, extraSongs);
      }
      return song && song.title ? song.title : 'untitled';
    }

    function update(detail) {
      const d = detail || {};
      const song = d.song !== undefined ? d.song : getActiveSong();
      const show = !!(song && song.playbackId);

      setBarVisible(show);
      if (!show) return;

      titleEl.textContent = titleForSong(song);
      if (playBtn) {
        const playing = d.playing !== undefined ? !!d.playing : !!(muxPlayer && !muxPlayer.paused);
        if (opts.useSvgPlayButton && typeof globalRef.updateBottomPlayButton === 'function') {
          globalRef.updateBottomPlayButton(playing);
        } else {
          playBtn.textContent = playing ? '❚❚' : '▶';
          playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        }
      }
      if (pickerApi) pickerApi.render();
      updateProgress();
    }

    function mountPicker() {
      if (!picker || !picker.mount) return;
      pickerApi = picker.mount({
        titleEl: titleEl,
        getActiveSong: getActiveSong,
        getVersions: function (active) {
          if (ctx && ctx.versionsForActive) return ctx.versionsForActive(active, extraSongs);
          return [active];
        },
        getSongHref: function (active) {
          if (ctx && ctx.songHubHref) return ctx.songHubHref(active);
          return 'song.html';
        },
        getEntryHref: function (active) {
          if (ctx && ctx.entryHref) return ctx.entryHref(active);
          return '';
        },
        onPlayVersion: function (song) {
          if (typeof opts.onPlayVersion === 'function') opts.onPlayVersion(song);
        }
      });
    }

    if (playBtn) {
      playBtn.addEventListener('click', function () {
        if (typeof opts.onTogglePlay === 'function') opts.onTogglePlay();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (typeof opts.onClose === 'function') opts.onClose();
        else update({ song: null, playing: false });
      });
    }

    if (progressBarArea) {
      progressBarArea.addEventListener('click', function (event) {
        const rect = progressBarArea.getBoundingClientRect();
        if (!rect.width) return;
        seekToRatio((event.clientX - rect.left) / rect.width);
      });
    }

    if (muxPlayer) {
      muxPlayer.addEventListener('timeupdate', updateProgress);
      muxPlayer.addEventListener('loadedmetadata', updateProgress);
      if (spinner) {
        muxPlayer.addEventListener('waiting', function () {
          spinner.style.display = 'block';
        });
        muxPlayer.addEventListener('playing', function () {
          spinner.style.display = 'none';
        });
        muxPlayer.addEventListener('pause', function () {
          spinner.style.display = 'none';
        });
      }
    }

    if (opts.playbackEventName) {
      globalRef.addEventListener(opts.playbackEventName, function (event) {
        update(event.detail);
      });
    }

    mountPicker();

    return {
      update: update,
      setBarVisible: setBarVisible,
      setExtraSongs: function (songs) {
        extraSongs = songs || [];
        if (pickerApi) pickerApi.render();
      },
      renderPicker: function () {
        if (pickerApi) pickerApi.render();
      }
    };
  }

  return { mount: mount };
});
