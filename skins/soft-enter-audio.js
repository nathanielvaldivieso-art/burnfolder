/**
 * One-way soft enter: index gate → audio constellation without a document reload.
 *
 * Safety invariants (Safari forever-spinner):
 *  - Never load Mux CDN or create mux-player while body has index-home / is-home-gate.
 *  - Leave gate mode first, then mount playback.
 *  - Return to gate stays a hard unload (home-music.js / popstate → index).
 *
 * Disable for comparison: ?softAudio=0 or ?hardAudio=1
 */
(function () {
  'use strict';

  var AUDIO_URL = 'audio.html';
  var MUX_CDN = 'https://cdn.jsdelivr.net/npm/@mux/mux-player';

  var entering = false;
  var entered = false;
  var audioHtmlCache = null;

  // Same stack as audio.html — loaded only AFTER gate classes are gone.
  var SCRIPT_CHAIN = [
    'entry-renderer.js',
    'shared/song-versions.js',
    'stripe-publishable.js',
    'shared/media-session.js?v=20260709l',
    'shared/playback-recall.js?v=20260709l',
    'album-pages.js?v=20260709l',
    'press-page.js?v=20260709l',
    'shared/playback-prefetch.js?v=20260709l',
    'shared/studio-tap.js?v=20260709l',
    'shared/mux-playback.js?v=20260723lock1',
    'shared/playback-context.js?v=20260709l',
    'shared/version-picker.js?v=20260709l',
    'shared/now-playing-bar.js?v=20260720play1',
    'scripts.js?v=20260720play2',
    'skins/home-music.js?v=20260720s',
    'shared/analytics-config.js',
    'shared/analytics-beacon.js'
  ];

  function softEnterEnabled() {
    try {
      var q = new URLSearchParams(window.location.search);
      if (q.get('softAudio') === '0' || q.get('hardAudio') === '1') return false;
    } catch (_) {}
    return true;
  }

  function isIndexGate() {
    return !!(document.body && document.body.classList.contains('index-home'));
  }

  function hardFallback(reason) {
    try {
      if (reason) console.warn('[soft-enter-audio]', reason);
    } catch (_) {}
    window.location.assign(AUDIO_URL);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (!src) {
        resolve();
        return;
      }
      var existing = document.querySelector('script[src="' + src.replace(/"/g, '\\"') + '"]');
      if (existing) {
        if (existing.dataset.bfLoaded === '1' || existing.getAttribute('data-bf-loaded') === '1') {
          resolve();
          return;
        }
        existing.addEventListener('load', function () {
          resolve();
        });
        existing.addEventListener('error', function () {
          reject(new Error('Failed to load ' + src));
        });
        return;
      }
      var script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.bfSoftAudio = '1';
      script.onload = function () {
        script.dataset.bfLoaded = '1';
        resolve();
      };
      script.onerror = function () {
        reject(new Error('Failed to load ' + src));
      };
      document.body.appendChild(script);
    });
  }

  function loadScriptChain(urls) {
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve();
      var src = urls[i++];
      return loadScript(src).then(next);
    }
    return next();
  }

  function waitForMuxPlayer() {
    if (typeof customElements === 'undefined') {
      return Promise.resolve();
    }
    if (customElements.get('mux-player')) return Promise.resolve();
    return customElements.whenDefined('mux-player');
  }

  function fetchAudioHtml() {
    if (audioHtmlCache) return Promise.resolve(audioHtmlCache);
    return fetch(AUDIO_URL, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error('audio.html ' + res.status);
      return res.text();
    }).then(function (html) {
      audioHtmlCache = html;
      return html;
    });
  }

  function ensureSpaContent() {
    var spa = document.getElementById('spa-content');
    if (spa) return spa;
    spa = document.createElement('div');
    spa.id = 'spa-content';
    document.body.appendChild(spa);
    return spa;
  }

  /**
   * Drop gate chrome before any Mux mount. Body must not be index-home when
   * scripts.js / mux-playback restore runs.
   */
  function leaveGateMode() {
    document.documentElement.classList.remove('bf-gate-boot');
    document.body.classList.remove('index-home', 'is-home-gate');
    document.body.classList.add('page-audio', 'bf-soft-audio');

    var gate = document.getElementById('skinMapPhotonegative');
    if (gate) {
      gate.hidden = true;
      gate.setAttribute('aria-hidden', 'true');
    }

    var scrollRoom = document.querySelector('.skin-map__scroll-room');
    if (scrollRoom && scrollRoom.parentNode) scrollRoom.parentNode.removeChild(scrollRoom);

    var skinToggle = document.getElementById('bfSkinToggle');
    if (skinToggle) skinToggle.hidden = true;

    window.scrollTo(0, 0);
  }

  function injectConstellation(doc) {
    var spa = ensureSpaContent();
    spa.innerHTML = '';

    var homeMusic = doc.getElementById('homeMusic');
    if (homeMusic) spa.appendChild(homeMusic.cloneNode(true));

    var watermark = doc.querySelector('.page-watermark');
    if (watermark) spa.appendChild(watermark.cloneNode(true));

    var audioList = doc.getElementById('audioList');
    if (audioList && !document.getElementById('audioList')) {
      spa.appendChild(audioList.cloneNode(true));
    }

    document.body.classList.add('bf-audio-booting');
  }

  function finishBoot() {
    document.body.classList.remove('bf-audio-booting');
    if (typeof window.mountSiteMenu === 'function') {
      window.mountSiteMenu();
    }
    try {
      window.dispatchEvent(
        new CustomEvent('burnfolder-spa-navigated', {
          detail: { url: AUDIO_URL, softEnter: true }
        })
      );
    } catch (_) {}
  }

  /**
   * Prefetch HTML early so scroll intent can paint the constellation immediately.
   */
  function warm() {
    if (!softEnterEnabled() || !isIndexGate()) return;
    fetchAudioHtml().catch(function () {
      audioHtmlCache = null;
    });
  }

  function enter() {
    if (entered) return Promise.resolve(true);
    if (entering) return Promise.resolve(false);

    if (!softEnterEnabled()) {
      hardFallback();
      return Promise.resolve(false);
    }

    if (!isIndexGate()) {
      hardFallback('not on gate');
      return Promise.resolve(false);
    }

    entering = true;

    return fetchAudioHtml()
      .then(function (html) {
        if (!isIndexGate()) {
          hardFallback('left gate during fetch');
          return false;
        }

        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        if (!doc.getElementById('homeMusic')) {
          throw new Error('audio shell missing #homeMusic');
        }

        // 1) Leave Mux-free gate  2) URL  3) paint constellation  4) then Mux
        leaveGateMode();
        try {
          history.pushState({ bfSoftAudio: 1 }, '', AUDIO_URL);
        } catch (_) {}
        document.title = doc.title || 'audio — burnfolder.com';
        injectConstellation(doc);
        window.scrollTo(0, 0);

        return loadScript(MUX_CDN)
          .then(waitForMuxPlayer)
          .then(function () {
            // scripts.js injects #bottomBar + mux-player only when not index-home
            return loadScriptChain(SCRIPT_CHAIN);
          })
          .then(function () {
            entered = true;
            finishBoot();
            return true;
          });
      })
      .catch(function (err) {
        hardFallback(err && err.message ? err.message : err);
        return false;
      })
      .then(function (ok) {
        entering = false;
        return ok;
      });
  }

  // Back to index after soft enter: spa-router hard-navs (enteringIndexHome).
  // Extra belt: if something soft-swaps into index URL without unload, force it.
  window.addEventListener('popstate', function () {
    if (!entered) return;
    try {
      var path = window.location.pathname || '';
      var base = path.split('/').pop() || '';
      var isIndex = !base || base === 'index' || base === 'index.html';
      if (isIndex) {
        window.location.assign('index.html');
      }
    } catch (_) {
      window.location.assign('index.html');
    }
  });

  window.BurnfolderSoftEnterAudio = {
    enter: enter,
    warm: warm,
    isEntered: function () {
      return entered;
    },
    isEnabled: softEnterEnabled
  };

  if (document.readyState === 'complete') {
    setTimeout(warm, 400);
  } else {
    window.addEventListener('load', function () {
      setTimeout(warm, 400);
    });
  }
})();
