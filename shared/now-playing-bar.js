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
    const progressBarArea =
      opts.progressEl ||
      (bar && bar.querySelector('.progress-bar-area')) ||
      document.getElementById('progressBarArea');
    const progressFill =
      opts.progressFillEl ||
      (progressBarArea && progressBarArea.querySelector('.progress')) ||
      document.getElementById('progress');
    const playheadEl =
      opts.playheadEl ||
      (progressBarArea && progressBarArea.querySelector('.progress-playhead')) ||
      document.getElementById('progressPlayhead');
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
      const guard = globalRef.BurnfolderPlaybackScrollGuard;
      const apply = function () {
        bar.style.display = show ? 'flex' : 'none';
        const bodyClass = opts.bodyActiveClass || 'stream-playback-active';
        if (bodyClass) document.body.classList.toggle(bodyClass, !!show);
        if (!show && pickerApi) pickerApi.close();
      };
      if (guard && guard.run) guard.run(apply);
      else apply();
    }

    function updateProgress() {
      if (isDragging) return;
      const duration = getDuration();
      if (!muxPlayer || !progressFill || !duration) return;
      const media = getMediaElement();
      const current = media ? media.currentTime : muxPlayer.currentTime;
      const pct = Math.min(100, Math.max(0, (current / duration) * 100));
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

    function getMediaElement() {
      if (!muxPlayer) return null;
      return muxPlayer.media || muxPlayer;
    }

    function getDuration() {
      if (!muxPlayer) return 0;
      const direct = muxPlayer.duration;
      if (Number.isFinite(direct) && direct > 0) return direct;
      const media = getMediaElement();
      if (!media) return 0;
      if (Number.isFinite(media.duration) && media.duration > 0) return media.duration;
      if (media.seekable && media.seekable.length > 0) {
        const end = media.seekable.end(media.seekable.length - 1);
        if (Number.isFinite(end) && end > 0) return end;
      }
      return 0;
    }

    function canSeek() {
      return !!getActiveSong() && !!muxPlayer && getDuration() > 0;
    }

    let isDragging = false;
    let pendingFrame = null;
    let cachedRect = null;
    let lastSeekAt = 0;
    const SEEK_THROTTLE = 16;

    function nowMs() {
      return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    }

    function eventClientX(event) {
      if (event.changedTouches && event.changedTouches.length) {
        return event.changedTouches[0].clientX;
      }
      if (event.touches && event.touches.length) {
        return event.touches[0].clientX;
      }
      return event.clientX;
    }

    function ratioFromEvent(event) {
      if (!progressBarArea) return 0;
      if (!cachedRect) cachedRect = progressBarArea.getBoundingClientRect();
      const width = cachedRect.width;
      if (!width) return 0;
      return Math.max(0, Math.min(1, (eventClientX(event) - cachedRect.left) / width));
    }

    function applySeekRatio(ratio, seekOpts) {
      const duration = getDuration();
      if (!duration) return;
      const options = seekOpts || {};
      const clientX =
        options.clientX != null
          ? options.clientX
          : cachedRect
            ? cachedRect.left + ratio * cachedRect.width
            : 0;
      const top = cachedRect ? cachedRect.top : 0;
      showHoverTime(clientX, top, ratio * duration);
      if (progressFill) progressFill.style.width = ratio * 100 + '%';
      if (playheadEl) playheadEl.style.left = ratio * 100 + '%';

      const seekTo = ratio * duration;
      const doSeek = function () {
        const media = getMediaElement();
        if (!media) return;
        try {
          if (Math.abs(media.currentTime - seekTo) > 0.05) {
            media.currentTime = seekTo;
          }
        } catch (err) {
          /* ignore errors during rapid seeking */
        }
      };

      if (options.immediate) {
        doSeek();
        lastSeekAt = nowMs();
        return;
      }

      const ts = nowMs();
      if (ts - lastSeekAt < SEEK_THROTTLE) return;
      lastSeekAt = ts;
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      pendingFrame = requestAnimationFrame(function () {
        doSeek();
        pendingFrame = null;
      });
    }

    function updateFromEvent(event) {
      if (!canSeek() || !progressBarArea) return;
      applySeekRatio(ratioFromEvent(event), { clientX: eventClientX(event) });
    }

    function commitSeekFromEvent(event) {
      if (!canSeek() || !progressBarArea) return;
      cachedRect = progressBarArea.getBoundingClientRect();
      applySeekRatio(ratioFromEvent(event), {
        immediate: true,
        clientX: eventClientX(event)
      });
    }

    function endDrag(event) {
      if (!isDragging) return;
      if (pendingFrame) {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      }
      if (event && canSeek()) {
        commitSeekFromEvent(event);
      }
      isDragging = false;
      if (progressBarArea) {
        progressBarArea.classList.remove('dragging');
        if (event && event.pointerId != null) {
          try {
            progressBarArea.releasePointerCapture(event.pointerId);
          } catch (err) {
            /* ignore */
          }
        }
      }
      hideHoverTime();
      cachedRect = null;
      lastSeekAt = 0;
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
      progressBarArea.addEventListener(
        'pointerdown',
        function (event) {
          if (!canSeek()) return;
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          isDragging = true;
          progressBarArea.classList.add('dragging');
          cachedRect = null;
          try {
            progressBarArea.setPointerCapture(event.pointerId);
          } catch (err) {
            /* ignore */
          }
          commitSeekFromEvent(event);
          event.preventDefault();
        },
        { passive: false }
      );

      progressBarArea.addEventListener(
        'pointermove',
        function (event) {
          if (!isDragging) {
            if (!canSeek() || event.pointerType !== 'mouse') {
              hideHoverTime();
              return;
            }
            const rect = progressBarArea.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            showHoverTime(event.clientX, rect.top, ratio * getDuration());
            return;
          }
          updateFromEvent(event);
          event.preventDefault();
        },
        { passive: false }
      );

      progressBarArea.addEventListener('pointerup', endDrag);
      progressBarArea.addEventListener('pointercancel', endDrag);
      progressBarArea.addEventListener('pointerleave', function (event) {
        if (!isDragging && event.pointerType === 'mouse') hideHoverTime();
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
