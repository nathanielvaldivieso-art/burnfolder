(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const token = (params.get('t') || '').trim();

  const mainEl = document.getElementById('listenMain');
  const stateEl = document.getElementById('listenState');
  const titleEl = document.getElementById('listenTitle');
  const subtitleEl = document.getElementById('listenSubtitle');
  const coverWrap = document.getElementById('listenCoverWrap');
  const coverEl = document.getElementById('listenCover');
  const playBtn = document.getElementById('listenPlayBtn');
  const tracklistEl = document.getElementById('listenTracklist');
  const bottomBar = document.getElementById('bottomBar');
  const bottomPlayBtn = document.getElementById('bottomPlayPause');
  const songTitleEl = document.getElementById('songTitle');
  const progressEl = document.getElementById('progress');
  const progressBarArea = document.getElementById('progressBarArea');
  const progressPlayhead = document.getElementById('progressPlayhead');
  const closeBtn = document.getElementById('closeBtn');
  const activeMuxPlayer = document.getElementById('activeMuxPlayer');
  const loadingSpinner = document.getElementById('loadingSpinner');

  const api = window.BurnfolderShareLinks;
  let shareData = null;
  let tracks = [];
  let activeIdx = 0;
  let playTracked = false;
  let engine = null;

  function setState(msg) {
    if (stateEl) {
      stateEl.textContent = msg || '';
      stateEl.hidden = !msg;
    }
  }

  function getEngine() {
    if (!engine && activeMuxPlayer && window.BurnfolderMuxPlayback) {
      engine = window.BurnfolderMuxPlayback.create({
        getPlayer: function () {
          return activeMuxPlayer;
        },
        bindEnded: true,
        recall: false,
        restoreRecall: false,
        artist: 'burnfolder',
        album: 'private link',
        onStateChange: function () {
          updateUI();
          syncTracklist();
        },
        onAfterStart: function () {
          if (!playTracked && token) {
            playTracked = true;
            api.trackPlay(token);
          }
        }
      });
    }
    return engine;
  }

  function getActiveSong() {
    const e = getEngine();
    return e ? e.getActiveSong() : null;
  }

  function updateUI() {
    const active = getActiveSong();
    if (!active || !bottomBar || !bottomPlayBtn) return;
    bottomBar.style.display = 'block';
    document.body.classList.add('playback-active');
    const playing = activeMuxPlayer && !activeMuxPlayer.paused;
    document.body.classList.toggle('playback-playing', playing);
    bottomPlayBtn.innerHTML = playing
      ? '<svg width="24" height="24" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/></svg>'
      : '<svg width="24" height="24" viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20" fill="currentColor"/></svg>';
    if (songTitleEl) songTitleEl.textContent = active.title || '—';
    if (playBtn) playBtn.classList.toggle('is-playing', playing);
  }

  function syncTracklist() {
    if (!tracklistEl) return;
    const active = getActiveSong();
    tracklistEl.querySelectorAll('.listen-track-row').forEach(function (row) {
      const isActive = !!(active && row.dataset.playbackId === active.playbackId);
      const playing = isActive && activeMuxPlayer && !activeMuxPlayer.paused;
      row.classList.toggle('is-active', isActive);
      row.classList.toggle('is-playing', playing);
    });
  }

  function startPlayback(idx) {
    const e = getEngine();
    if (!e || !tracks.length) return;
    const i = typeof idx === 'number' ? idx : 0;
    e.startPlayback(tracks[i], tracks, i, { immediatePlay: true });
    updateUI();
    syncTracklist();
  }

  function renderTracklist() {
    if (!tracklistEl) return;
    tracklistEl.innerHTML = '';
    if (tracks.length <= 1) {
      tracklistEl.hidden = true;
      return;
    }
    tracklistEl.hidden = false;
    tracks.forEach(function (song, idx) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'listen-track-row';
      row.dataset.playbackId = song.playbackId;
      row.textContent = song.title;
      row.addEventListener('click', function () {
        startPlayback(idx);
      });
      tracklistEl.appendChild(row);
    });
  }

  function bindChrome() {
    if (bottomPlayBtn) {
      bottomPlayBtn.addEventListener('click', function () {
        const e = getEngine();
        if (e) e.togglePlayPause();
        updateUI();
        syncTracklist();
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        const e = getEngine();
        if (e) e.stop();
        if (bottomBar) bottomBar.style.display = 'none';
        document.body.classList.remove('playback-active', 'playback-playing');
        if (playBtn) playBtn.classList.remove('is-playing');
        syncTracklist();
      });
    }
    if (playBtn) {
      playBtn.addEventListener('click', function () {
        const active = getActiveSong();
        if (active && activeMuxPlayer && !activeMuxPlayer.paused) {
          const e = getEngine();
          if (e) e.togglePlayPause();
          updateUI();
          return;
        }
        if (active && activeMuxPlayer && activeMuxPlayer.paused) {
          activeMuxPlayer.play().catch(function () {});
          updateUI();
          return;
        }
        startPlayback(activeIdx);
      });
    }

    if (activeMuxPlayer && progressBarArea && progressEl) {
      activeMuxPlayer.addEventListener('timeupdate', function () {
        const duration = activeMuxPlayer.duration;
        const current = activeMuxPlayer.currentTime;
        if (!duration || !isFinite(duration)) return;
        const pct = (current / duration) * 100;
        progressEl.style.width = pct + '%';
        if (progressPlayhead) progressPlayhead.style.left = pct + '%';
      });
      progressBarArea.addEventListener('click', function (event) {
        const rect = progressBarArea.getBoundingClientRect();
        const pct = (event.clientX - rect.left) / rect.width;
        if (activeMuxPlayer.duration && isFinite(activeMuxPlayer.duration)) {
          activeMuxPlayer.currentTime = pct * activeMuxPlayer.duration;
        }
      });
    }

    if (activeMuxPlayer) {
      activeMuxPlayer.addEventListener('ended', function () {
        if (activeIdx < tracks.length - 1) {
          activeIdx += 1;
          startPlayback(activeIdx);
        }
      });
    }
  }

  function boot(share) {
    shareData = share;
    tracks = (share.tracks || []).slice();
    if (!tracks.length) {
      setState('nothing to play');
      return;
    }

    if (titleEl) titleEl.textContent = share.title || 'untitled';
    if (subtitleEl) {
      if (share.subtitle) {
        subtitleEl.textContent = share.subtitle;
        subtitleEl.hidden = false;
      } else {
        subtitleEl.hidden = true;
      }
    }

    if (share.coverArt && coverEl && coverWrap) {
      coverEl.src = share.coverArt;
      coverEl.alt = (share.title || 'cover') + ' cover';
      coverWrap.hidden = false;
    }

    renderTracklist();
    if (mainEl) mainEl.hidden = false;
    setState('');
    bindChrome();
  }

  if (!token || !api) {
    setState('invalid link');
  } else {
    api
      .resolveShare(token)
      .then(function (data) {
        if (!data || !data.share) throw new Error('invalid response');
        boot(data.share);
      })
      .catch(function (err) {
        if (err.status === 410) setState('this link has been revoked');
        else if (err.status === 404) setState('link not found');
        else setState('could not load link');
      });
  }
})();
