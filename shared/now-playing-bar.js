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

  // Canonical bottom-bar play/pause glyphs (burnfolder.com behavior — see COPILOT.md).
  const PLAY_SVG =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><polygon points="6,4 20,12 6,20" fill="currentColor"/></svg>';
  const PAUSE_SVG =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/></svg>';

  function formatTimecode(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
    const whole = Math.floor(totalSeconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const seconds = whole % 60;
    if (hours > 0) {
      return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }
    return minutes + ':' + String(seconds).padStart(2, '0');
  }

  function mount(options) {
    const opts = options || {};
    const bar = opts.barEl || document.getElementById('bottomBar');
    const titleEl = opts.titleEl || document.getElementById('songTitle') || document.getElementById('streamNowPlayingTitle');
    const playBtn = opts.playBtnEl || document.getElementById('bottomPlayPause') || document.getElementById('streamPlayPause');
    const closeBtn = opts.closeBtnEl || document.getElementById('closeBtn') || document.getElementById('streamNowPlayingClose');
    const progressBarArea = opts.progressEl || document.getElementById('progressBarArea');
    const progressFill = document.getElementById('progress');
    const playheadEl = document.getElementById('progressPlayhead');
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
      bar.style.display = show ? 'flex' : 'none';
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

    function renderPlayButton(playing) {
      if (!playBtn) return;
      playBtn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }

    function playingFromPlayer() {
      return !!(muxPlayer && !muxPlayer.paused);
    }

    function togglePlayFromBar() {
      if (typeof opts.onTogglePlay !== 'function') return;
      renderPlayButton(!playingFromPlayer());
      opts.onTogglePlay();
    }

    // ── progress seek: click + drag + touch-drag with hover timestamp (burnfolder.com parity) ──
    let hoverTip = null;
    function ensureHoverTip() {
      if (hoverTip) return hoverTip;
      hoverTip = document.createElement('div');
      hoverTip.className = 'progress-hover-time';
      document.body.appendChild(hoverTip);
      return hoverTip;
    }
    function showHoverTime(clientX, top, seconds) {
      const tip = ensureHoverTip();
      tip.textContent = formatTimecode(seconds);
      tip.style.left = clientX + 'px';
      tip.style.top = top + 'px';
      tip.classList.add('visible');
    }
    function hideHoverTime() {
      if (hoverTip) hoverTip.classList.remove('visible');
    }

    function canSeek() {
      return !!getActiveSong() && !!muxPlayer && !!muxPlayer.duration && !Number.isNaN(muxPlayer.duration);
    }

    let isDragging = false;
    let pendingFrame = null;
    let cachedRect = null;
    let lastSeekAt = 0;
    const SEEK_THROTTLE = 16;

    function nowMs() {
      return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    }

    function updateFromEvent(event) {
      if (!canSeek() || !progressBarArea) return;
      const ts = nowMs();
      if (!cachedRect) cachedRect = progressBarArea.getBoundingClientRect();
      const clientX = event.touches ? event.touches[0].clientX : event.clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - cachedRect.left) / cachedRect.width));
      showHoverTime(clientX, cachedRect.top, ratio * muxPlayer.duration);
      if (progressFill) progressFill.style.width = ratio * 100 + '%';
      if (playheadEl) playheadEl.style.left = ratio * 100 + '%';
      if (ts - lastSeekAt >= SEEK_THROTTLE) {
        if (pendingFrame) cancelAnimationFrame(pendingFrame);
        pendingFrame = requestAnimationFrame(function () {
          try {
            const newTime = ratio * muxPlayer.duration;
            if (Math.abs(muxPlayer.currentTime - newTime) > 0.1) muxPlayer.currentTime = newTime;
          } catch (err) {
            /* ignore errors during rapid seeking */
          }
          pendingFrame = null;
        });
        lastSeekAt = ts;
      }
    }

    function endDrag() {
      if (!isDragging) return;
      isDragging = false;
      if (progressBarArea) progressBarArea.classList.remove('dragging');
      hideHoverTime();
      cachedRect = null;
      lastSeekAt = 0;
      if (pendingFrame) {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      }
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
        renderPlayButton(playing);
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
      const tap = globalRef.BurnfolderTouchTap || globalRef.BurnfolderStudioTap;
      if (tap && tap.bind) {
        tap.bind(playBtn, togglePlayFromBar);
      } else {
        playBtn.addEventListener('click', togglePlayFromBar);
      }
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (typeof opts.onClose === 'function') opts.onClose();
        else update({ song: null, playing: false });
      });
    }

    if (progressBarArea) {
      progressBarArea.addEventListener('mousedown', function (event) {
        if (!canSeek()) return;
        isDragging = true;
        progressBarArea.classList.add('dragging');
        cachedRect = null;
        updateFromEvent(event);
        event.preventDefault();
      });
      progressBarArea.addEventListener('mousemove', function (event) {
        if (isDragging) return;
        if (!canSeek()) {
          hideHoverTime();
          return;
        }
        const rect = progressBarArea.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        showHoverTime(event.clientX, rect.top, ratio * muxPlayer.duration);
      });
      progressBarArea.addEventListener('mouseleave', function () {
        if (!isDragging) hideHoverTime();
      });
      progressBarArea.addEventListener('touchstart', function (event) {
        if (!canSeek()) return;
        isDragging = true;
        progressBarArea.classList.add('dragging');
        cachedRect = null;
        updateFromEvent(event);
        event.preventDefault();
      });
      progressBarArea.addEventListener('touchcancel', endDrag);

      document.addEventListener('mousemove', function (event) {
        if (isDragging) {
          updateFromEvent(event);
          event.preventDefault();
        }
      });
      document.addEventListener('mouseup', endDrag);
      document.addEventListener(
        'touchmove',
        function (event) {
          if (isDragging) {
            updateFromEvent(event);
            event.preventDefault();
          }
        },
        { passive: false }
      );
      document.addEventListener('touchend', endDrag);
      document.addEventListener('pointermove', function (event) {
        if (!isDragging && !progressBarArea.contains(event.target)) hideHoverTime();
      });
      window.addEventListener('blur', endDrag);
    }

    if (muxPlayer) {
      muxPlayer.addEventListener('timeupdate', updateProgress);
      muxPlayer.addEventListener('loadedmetadata', updateProgress);
      muxPlayer.addEventListener('play', function () {
        renderPlayButton(true);
      });
      muxPlayer.addEventListener('pause', function () {
        renderPlayButton(false);
      });
      // No buffering spinner: it shifted the play/close buttons each time a track
      // started. Intentionally not bound — see COPILOT.md "No-jump rule".
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
