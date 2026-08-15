(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var token = (params.get('t') || '').trim();

  var mainEl = document.getElementById('watchMain');
  var stateEl = document.getElementById('watchState');
  var titleEl = document.getElementById('watchTitle');
  var subtitleEl = document.getElementById('watchSubtitle');
  var stageEl = document.getElementById('watchStage');
  var downloadBtn = document.getElementById('watchDownloadBtn');
  var shareBtn = document.getElementById('watchShareBtn');
  var tracklistEl = document.getElementById('watchTracklist');

  var api = window.BurnfolderShareLinks;
  var tracks = [];
  var activeIdx = 0;
  var playTracked = false;
  var playerEl = null;

  function setState(msg) {
    if (!stateEl) return;
    stateEl.textContent = msg || '';
    stateEl.hidden = !msg;
  }

  function safeFilename(name, fallback) {
    var raw = String(name || fallback || 'video').trim();
    return raw || fallback || 'video';
  }

  function ensurePlayer() {
    if (playerEl) return playerEl;
    if (!stageEl) return null;
    playerEl = document.createElement('mux-player');
    playerEl.setAttribute('playsinline', '');
    playerEl.setAttribute('stream-type', 'on-demand');
    playerEl.setAttribute('preload', 'metadata');
    playerEl.setAttribute('playbackrates', '1 1.5 2');
    playerEl.setAttribute('noairplay', '');
    playerEl.className = 'page-inline-video watch-video';
    playerEl.addEventListener('play', function () {
      if (playTracked || !token || !api) return;
      playTracked = true;
      api.trackPlay(token, 'play');
    });
    stageEl.appendChild(playerEl);
    return playerEl;
  }

  function updateDownloadBtn(track) {
    if (!downloadBtn) return;
    if (!track || !track.downloadUrl) {
      downloadBtn.hidden = true;
      return;
    }
    downloadBtn.hidden = false;
    downloadBtn.href = track.downloadUrl;
    downloadBtn.setAttribute('download', safeFilename(track.title, 'video'));
  }

  function syncTracklist() {
    if (!tracklistEl) return;
    var rows = tracklistEl.querySelectorAll('.watch-track-row');
    for (var i = 0; i < rows.length; i += 1) {
      rows[i].classList.toggle('is-active', i === activeIdx);
    }
  }

  function playActivePlayer(player) {
    if (!player || typeof player.play !== 'function') return;
    var start = function () {
      var p = player.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    };
    if (player.readyState >= 2) {
      start();
      return;
    }
    player.addEventListener('canplay', start, { once: true });
  }

  function loadTrack(idx, opts) {
    var options = opts || {};
    var track = tracks[idx];
    if (!track) return;
    activeIdx = idx;
    playTracked = false;
    var player = ensurePlayer();
    if (!player) return;
    player.setAttribute('metadata-video-title', track.title || 'video');
    if (track.posterUrl) player.setAttribute('poster', track.posterUrl);
    else player.removeAttribute('poster');
    player.setAttribute('playback-id', track.playbackId);
    updateDownloadBtn(track);
    syncTracklist();
    if (options.autoplay) playActivePlayer(player);
  }

  function renderTracklist() {
    if (!tracklistEl) return;
    tracklistEl.innerHTML = '';
    if (tracks.length <= 1) {
      tracklistEl.hidden = true;
      return;
    }
    tracklistEl.hidden = false;
    tracks.forEach(function (track, idx) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'watch-track-row';
      row.textContent = track.title || 'clip ' + (idx + 1);
      row.addEventListener('click', function () {
        loadTrack(idx, { autoplay: true });
      });
      tracklistEl.appendChild(row);
    });
  }

  function bindDownloadTracking() {
    if (!downloadBtn) return;
    downloadBtn.addEventListener('click', function () {
      if (token && api) api.trackPlay(token, 'download');
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) {
        document.body.removeChild(ta);
        reject(e);
      }
    });
  }

  function bindShare() {
    if (!shareBtn) return;
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', function () {
      var url = window.location.href;
      var title = (titleEl && titleEl.textContent) || 'video';
      var done = function (msg) {
        setState(msg);
        window.setTimeout(function () {
          if (stateEl && stateEl.textContent === msg) setState('');
        }, 1600);
      };
      if (navigator.share) {
        navigator
          .share({ title: title, text: title, url: url })
          .then(function () {
            done('shared');
          })
          .catch(function (err) {
            if (err && err.name === 'AbortError') return;
            copyText(url)
              .then(function () {
                done('link copied');
              })
              .catch(function () {
                done('could not share');
              });
          });
        return;
      }
      copyText(url)
        .then(function () {
          done('link copied');
        })
        .catch(function () {
          done('could not share');
        });
    });
  }

  function boot(share) {
    tracks = (share.tracks || []).filter(function (t) {
      return t && t.playbackId;
    });
    if (!tracks.length) {
      setState('nothing to watch');
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

    renderTracklist();
    bindDownloadTracking();
    bindShare();
    loadTrack(0, { autoplay: false });
    if (mainEl) mainEl.hidden = false;
    setState('');
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
