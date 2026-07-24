/* Site skins — toggle without destroying the default layout.
   Usage:
     BurnfolderSkins.set('photonegative')
     BurnfolderSkins.set('default')
     ?skin=photonegative | ?skin=default
     ?hitboxes=1

   Index home: photonegative fills the viewport; scroll/swipe down → audio.html.

   Button logic (pixel-exact):
     1. Photo + hit masks + traces share the same object-fit frame
     2. Hit mask alpha is sampled under the pointer (canvas)
     3. Opaque hit pixel → that button lights (trace shown) and is clickable
   Assign links in skins/hotspots.js
*/
(function () {
  'use strict';

  var STORAGE_KEY = 'bf-skin';
  var HITBOX_KEY = 'bf-hitboxes';
  var KNOWN = { default: true, photonegative: true };

  var hitCanvases = []; // { id, canvas, ctx, spot, href, hasLink }
  var activeId = null;
  var pointerBound = false;
  var gateBound = false;
  var gatePinnedOnce = false;
  var scrollToAudioLock = false;
  var touchStartY = null;

  function readQuery() {
    try {
      return new URLSearchParams(window.location.search);
    } catch (_) {
      return new URLSearchParams();
    }
  }

  function currentSkin() {
    var attr = document.documentElement.getAttribute('data-skin');
    if (attr && KNOWN[attr]) return attr;
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored && KNOWN[stored]) return stored;
    } catch (_) {}
    return 'default';
  }

  function applyHitboxes(on) {
    if (on) document.documentElement.setAttribute('data-hitboxes', '1');
    else document.documentElement.removeAttribute('data-hitboxes');
    try {
      if (on) localStorage.setItem(HITBOX_KEY, '1');
      else localStorage.removeItem(HITBOX_KEY);
    } catch (_) {}
  }

  function syncSkinQuery(skin, persist) {
    if (!persist || !window.history || !window.history.replaceState) return;
    try {
      var url = new URL(window.location.href);
      if (skin === 'default') url.searchParams.delete('skin');
      else url.searchParams.set('skin', skin);
      var next = url.pathname + url.search + url.hash;
      var cur = window.location.pathname + window.location.search + window.location.hash;
      if (next !== cur) window.history.replaceState(window.history.state, '', next);
    } catch (_) {}
  }

  function applySkin(name, opts) {
    var skin = KNOWN[name] ? name : 'default';
    var persist = !opts || opts.persist !== false;

    if (skin === 'default') {
      document.documentElement.removeAttribute('data-skin');
      if (persist) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch (_) {}
      }
    } else {
      document.documentElement.setAttribute('data-skin', skin);
      if (persist) {
        try {
          localStorage.setItem(STORAGE_KEY, skin);
        } catch (_) {}
      }
    }

    syncSkinQuery(skin, persist);
    syncToggleLabel();
    syncLatestEntryLink();
    return skin;
  }

  function toggleSkin() {
    return applySkin(currentSkin() === 'photonegative' ? 'default' : 'photonegative');
  }

  function syncToggleLabel() {
    var btn = document.getElementById('bfSkinToggle');
    if (!btn) return;
    var skin = currentSkin();
    var onHome = document.body.classList.contains('index-home');
    btn.hidden = !onHome;
    if (skin === 'photonegative') {
      btn.textContent = 'default';
      btn.setAttribute('aria-label', 'Switch to default home layout');
      btn.title = 'Switch to default home layout';
    } else {
      btn.textContent = 'photonegative';
      btn.setAttribute('aria-label', 'Switch to photonegative image-map skin');
      btn.title = 'Switch to photonegative image-map skin';
    }
  }

  function mountToggle() {
    var btn = document.getElementById('bfSkinToggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'bfSkinToggle';
      btn.setAttribute('data-bf-skin-chrome', '1');
      btn.addEventListener('click', function () {
        toggleSkin();
      });
    }

    var spa = document.getElementById('spa-content');
    if (spa && btn.parentElement === spa) {
      document.body.appendChild(btn);
    } else if (!btn.isConnected) {
      document.body.appendChild(btn);
    } else if (spa && btn.compareDocumentPosition(spa) & Node.DOCUMENT_POSITION_FOLLOWING) {
      document.body.appendChild(btn);
    }

    syncToggleLabel();
  }

  function syncLatestEntryLink() {
    var links = document.querySelectorAll('[data-skin-hotspot="latest-entry"]');
    if (!links.length) return;
    var entries = window.journalEntries;
    var href = entries && entries.length ? entries[0] + '.html' : 'index.html';
    links.forEach(function (link) {
      link.setAttribute('href', href);
    });
  }

  function bindHotspotActions() {
    document.addEventListener('click', function (e) {
      var unassigned = e.target.closest('.skin-map__spot.is-unassigned');
      if (unassigned) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      var el = e.target.closest('[data-skin-set]');
      if (!el) return;
      var next = el.getAttribute('data-skin-set');
      if (!next || !KNOWN[next]) return;
      e.preventDefault();
      e.stopPropagation();
      applySkin(next);
    });
  }

  function isIndexHome() {
    return !!(document.body && document.body.classList.contains('index-home'));
  }

  function getGate() {
    return document.getElementById('skinMapPhotonegative');
  }

  function ensureSkinOutsideSpa() {
    var gate = getGate();
    var spa = document.getElementById('spa-content');
    var bottomBar = document.getElementById('bottomBar');
    if (gate && spa && gate.parentElement === spa) {
      if (bottomBar) document.body.insertBefore(gate, bottomBar);
      else document.body.appendChild(gate);
    }
  }

  function clearGateBoot() {
    document.documentElement.classList.remove('bf-gate-boot');
  }

  function syncGateState() {
    if (!isIndexHome() || !getGate()) {
      document.body.classList.remove('is-home-gate');
      clearGateBoot();
      return;
    }
    document.body.classList.add('is-home-gate');
  }

  function goToAudioPage() {
    if (scrollToAudioLock || !isIndexHome()) return;
    scrollToAudioLock = true;
    // One-way soft enter keeps you in the moment; Mux mounts only after gate is gone.
    // Fallback: hard nav (?softAudio=0 / ?hardAudio=1 / soft-enter failure).
    var soft = window.BurnfolderSoftEnterAudio;
    if (soft && typeof soft.enter === 'function' && soft.isEnabled()) {
      soft.enter().then(function (ok) {
        // Stay locked on success (we're on audio). Unlock only if soft enter
        // aborted without navigating so the gesture can retry.
        if (!ok) scrollToAudioLock = false;
      });
      return;
    }
    window.location.assign('audio.html');
  }

  var audioPrefetchStarted = false;

  function shouldSkipAudioPrefetch() {
    try {
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) {
        if (conn.saveData) return true;
        var type = String(conn.effectiveType || '');
        if (type === 'slow-2g' || type === '2g') return true;
      }
    } catch (_) {}
    return false;
  }

  function hintOnce(rel, href, attrs) {
    if (!href) return;
    var sel = 'link[rel="' + rel + '"][href="' + href.replace(/"/g, '\\"') + '"]';
    if (document.head.querySelector(sel)) return;
    var link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        link.setAttribute(key, attrs[key]);
      });
    }
    document.head.appendChild(link);
  }

  /**
   * Warm audio.html + its critical assets while the gate is idle.
   * Prefetch/preconnect only — never execute Mux on the landing (Safari spinner).
   */
  function prefetchAudioDestination() {
    if (audioPrefetchStarted || !isIndexHome() || shouldSkipAudioPrefetch()) return;
    audioPrefetchStarted = true;

    // DNS/TLS for Mux CDN — cache only, no player element on this page.
    hintOnce('dns-prefetch', 'https://www.mux.com');
    hintOnce('preconnect', 'https://cdn.jsdelivr.net', { crossorigin: '' });
    hintOnce('preconnect', 'https://stream.mux.com', { crossorigin: '' });
    hintOnce('preconnect', 'https://image.mux.com', { crossorigin: '' });

    // Document first — biggest win for the hard nav.
    hintOnce('prefetch', 'audio.html', { as: 'document' });

    var critical = [
      'skins/home-music.js?v=20260720s',
      'scripts.js?v=20260720play2',
      'shared/mux-playback.js?v=20260723lock1',
      'shared/now-playing-bar.js?v=20260720play1',
      'shared/playback-context.js?v=20260709l',
      'shared/version-picker.js?v=20260709l',
      'shared/studio-tap.js?v=20260709l',
      'shared/playback-prefetch.js?v=20260709l',
      'shared/media-session.js?v=20260709l',
      'shared/playback-recall.js?v=20260709l',
      'album-pages.js?v=20260709l',
      'shared/song-versions.js',
      'entry-renderer.js'
    ];

    // Mux player script as prefetch (cached, not executed on the gate).
    critical.push('https://cdn.jsdelivr.net/npm/@mux/mux-player');

    function warmList(urls) {
      urls.forEach(function (href) {
        hintOnce('prefetch', href, { as: 'script' });
      });
    }

    // Two idle waves so we don't contend with gate image decode.
    var wave1 = critical.slice(0, 5);
    var wave2 = critical.slice(5);

    function runIdle(fn) {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(fn, { timeout: 2500 });
      } else {
        setTimeout(fn, 900);
      }
    }

    runIdle(function () {
      warmList(wave1);
      runIdle(function () {
        warmList(wave2);
      });
    });
  }

  function gateScrollY() {
    return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  function pinToGate() {
    if (!isIndexHome()) {
      clearGateBoot();
      return false;
    }
    ensureSkinOutsideSpa();
    var gate = getGate();
    if (!gate) {
      clearGateBoot();
      return false;
    }

    window.scrollTo(0, 0);
    document.body.classList.add('is-home-gate');
    clearGateBoot();
    gatePinnedOnce = true;
    syncGateState();
    return true;
  }

  function onGate() {
    return isIndexHome() && document.body.classList.contains('is-home-gate') && !scrollToAudioLock;
  }

  function bindHomeGate() {
    if (gateBound) return;
    gateBound = true;
    var gateArmed = false;

    if ('scrollRestoration' in history) {
      try {
        history.scrollRestoration = 'manual';
      } catch (_) {}
    }

    function armGateNavigation() {
      window.scrollTo(0, 0);
      gateArmed = false;
      setTimeout(function () {
        window.scrollTo(0, 0);
        gateArmed = true;
        prefetchAudioDestination();
      }, 150);
    }

    window.addEventListener('resize', syncGateState);

    // Prefer scroll: Safari often suppresses wheel when the page can't scroll.
    // Do not navigate until armed — layout during load can produce spurious scrollY.
    window.addEventListener(
      'scroll',
      function () {
        if (!onGate() || !gateArmed) return;
        if (gateScrollY() < 40) return;
        goToAudioPage();
      },
      { passive: true }
    );

    window.addEventListener(
      'wheel',
      function (e) {
        if (!onGate() || !gateArmed) return;
        var dy = e.deltaY;
        if (Math.abs(dy) < 1 && Math.abs(e.deltaX) > Math.abs(dy)) dy = e.deltaX;
        if (dy <= 0) return;
        e.preventDefault();
        goToAudioPage();
      },
      { passive: false, capture: true }
    );

    window.addEventListener('keydown', function (e) {
      if (!onGate() || !gateArmed) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || (e.key === ' ' && !e.repeat)) {
        e.preventDefault();
        goToAudioPage();
      }
    });

    window.addEventListener(
      'touchstart',
      function (e) {
        if (!onGate() || !gateArmed) return;
        var touch = e.changedTouches && e.changedTouches[0];
        touchStartY = touch ? touch.clientY : null;
      },
      { passive: true, capture: true }
    );

    window.addEventListener(
      'touchmove',
      function (e) {
        if (!onGate() || !gateArmed || touchStartY == null) return;
        var touch = e.changedTouches && e.changedTouches[0];
        if (!touch) return;
        // Finger moves up = scroll down intent
        if (touchStartY - touch.clientY < 40) return;
        e.preventDefault();
        touchStartY = null;
        goToAudioPage();
      },
      { passive: false, capture: true }
    );

    window.addEventListener(
      'touchend',
      function () {
        touchStartY = null;
      },
      { passive: true, capture: true }
    );

    window.addEventListener(
      'touchcancel',
      function () {
        touchStartY = null;
      },
      { passive: true, capture: true }
    );

    window.addEventListener('orientationchange', function () {
      setTimeout(function () {
        if (onGate()) {
          pinToGate();
          armGateNavigation();
        } else syncGateState();
      }, 80);
    });

    window.addEventListener('burnfolder-spa-navigated', function () {
      gatePinnedOnce = false;
      gateArmed = false;
      if (isIndexHome()) {
        scrollToAudioLock = false;
        touchStartY = null;
        var gate = getGate();
        if (gate) gate.hidden = false;
        document.documentElement.classList.add('bf-gate-boot');
        document.body.classList.add('is-home-gate');
        requestAnimationFrame(function () {
          pinToGate();
          mountHotspots();
          mountToggle();
          armGateNavigation();
        });
      } else {
        clearGateBoot();
        document.body.classList.remove('is-home-gate');
        syncToggleLabel();
      }
    });

    window.addEventListener('load', armGateNavigation);
    if (document.readyState === 'complete') armGateNavigation();
  }

  /** Map pointer → pixel in a natural-size image under object-fit:cover (or fill on mobile). */
  function pointerToImagePixel(frameEl, imgNaturalW, imgNaturalH, clientX, clientY) {
    var rect = frameEl.getBoundingClientRect();
    var rw = rect.width;
    var rh = rect.height;
    if (rw <= 0 || rh <= 0) return null;

    var fill = document.documentElement.getAttribute('data-skin-fit') === 'fill';
    var x;
    var y;
    if (fill) {
      x = ((clientX - rect.left) / rw) * imgNaturalW;
      y = ((clientY - rect.top) / rh) * imgNaturalH;
    } else {
      var scale = Math.max(rw / imgNaturalW, rh / imgNaturalH);
      var dispW = imgNaturalW * scale;
      var dispH = imgNaturalH * scale;
      var ox = (rw - dispW) / 2;
      var oy = (rh - dispH) / 2;
      x = (clientX - rect.left - ox) / scale;
      y = (clientY - rect.top - oy) / scale;
    }

    var ix = Math.floor(x);
    var iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= imgNaturalW || iy >= imgNaturalH) return null;
    return { x: ix, y: iy };
  }

  function setActiveSpot(id) {
    if (activeId === id) return;
    activeId = id;
    var root = document.getElementById('skinHotspots');
    if (!root) return;
    var spots = root.querySelectorAll('.skin-map__spot');
    var frame = document.querySelector('.skin-map__frame');
    spots.forEach(function (spot) {
      var on = spot.getAttribute('data-skin-btn') === id;
      spot.classList.toggle('is-hot', on);
    });
    if (frame) {
      frame.classList.toggle('is-over-hit', !!id);
    }
  }

  function hitTest(clientX, clientY) {
    var frame = document.querySelector('.skin-map__frame');
    if (!frame || !hitCanvases.length) return null;

    // Later entries sit on top — test reverse paint order
    for (var i = hitCanvases.length - 1; i >= 0; i--) {
      var entry = hitCanvases[i];
      var pt = pointerToImagePixel(
        frame,
        entry.canvas.width,
        entry.canvas.height,
        clientX,
        clientY
      );
      if (!pt) continue;
      var pix = entry.ctx.getImageData(pt.x, pt.y, 1, 1).data;
      if (pix[3] > 16) return entry;
    }
    return null;
  }

  function bindPixelPointer() {
    var stage = document.querySelector('.skin-map--photonegative .skin-map__stage');
    if (!stage || pointerBound) return;
    pointerBound = true;

    stage.addEventListener('pointermove', function (e) {
      if (!isIndexHome()) return;
      var hit = hitTest(e.clientX, e.clientY);
      setActiveSpot(hit ? hit.id : null);
      var frame = document.querySelector('.skin-map__frame');
      if (frame) {
        frame.classList.toggle(
          'is-over-hit',
          !!(hit && hit.hasLink && !hit.spot.classList.contains('is-unassigned'))
        );
      }
    });

    stage.addEventListener('pointerleave', function () {
      setActiveSpot(null);
    });

    stage.addEventListener('click', function (e) {
      if (!isIndexHome()) return;
      var hit = hitTest(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();

      var spot = hit.spot;
      if (spot.classList.contains('is-unassigned')) return;

      var skinSet = spot.getAttribute('data-skin-set');
      if (skinSet && KNOWN[skinSet]) {
        applySkin(skinSet);
        return;
      }

      var href = spot.getAttribute('href');
      if (!href || href === '#') return;
      try {
        var resolved = new URL(href, window.location.href);
        var name = (resolved.pathname.split('/').pop() || '').toLowerCase();
        if (
          (name === 'audio' || name === 'audio.html') &&
          window.BurnfolderSoftEnterAudio &&
          window.BurnfolderSoftEnterAudio.isEnabled()
        ) {
          window.BurnfolderSoftEnterAudio.enter();
          return;
        }
      } catch (_) {}
      window.location.assign(href);
    });
  }

  function loadHitCanvas(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        resolve({ canvas: canvas, ctx: ctx, width: canvas.width, height: canvas.height });
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function syncSkinFit() {
    var fill = window.matchMedia('(max-width: 600px)').matches;
    document.documentElement.setAttribute('data-skin-fit', fill ? 'fill' : 'cover');
  }

  var skinFitBound = false;
  function bindSkinFit() {
    syncSkinFit();
    if (skinFitBound || !window.matchMedia) return;
    skinFitBound = true;
    var mq = window.matchMedia('(max-width: 600px)');
    var onChange = function () {
      syncSkinFit();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
    window.addEventListener('orientationchange', function () {
      setTimeout(syncSkinFit, 50);
    });
  }

  function mountHotspots() {
    var root = document.getElementById('skinHotspots');
    if (!root) return;
    var list = window.BurnfolderSkinHotspots;
    if (!list || !list.length) return;

    root.innerHTML = '';
    hitCanvases = [];
    activeId = null;

    var loads = [];

    list.forEach(function (spot) {
      if (!spot || !spot.hit) return;
      var href = spot.href == null ? '' : String(spot.href);
      var hasLink = !!href;

      var a = document.createElement('a');
      a.className =
        'skin-map__spot skin-map__spot--' +
        spot.id +
        (spot.trace ? ' skin-map__spot--traced' : '');
      a.setAttribute('data-skin-btn', spot.id);
      a.setAttribute('aria-label', spot.label || spot.id);
      a.href = hasLink ? href : '#';
      if (!hasLink) {
        a.classList.add('is-unassigned');
        a.setAttribute('aria-disabled', 'true');
      }
      if (spot.attrs) {
        Object.keys(spot.attrs).forEach(function (key) {
          a.setAttribute(key, spot.attrs[key]);
        });
      }

      var hitImg = document.createElement('img');
      hitImg.className = 'skin-map__hit-img';
      hitImg.src = spot.hit;
      hitImg.alt = '';
      hitImg.decoding = 'async';
      hitImg.draggable = false;
      a.appendChild(hitImg);

      if (spot.trace) {
        var traceImg = document.createElement('img');
        traceImg.className = 'skin-map__trace';
        traceImg.src = spot.trace;
        traceImg.alt = '';
        traceImg.decoding = 'async';
        traceImg.draggable = false;
        a.appendChild(traceImg);
      }

      root.appendChild(a);

      loads.push(
        loadHitCanvas(spot.hit).then(function (c) {
          return {
            id: String(spot.id),
            canvas: c.canvas,
            ctx: c.ctx,
            spot: a,
            href: href,
            hasLink: hasLink
          };
        })
      );
    });

    Promise.all(loads)
      .then(function (entries) {
        // Keep config order (later = higher priority)
        var byId = {};
        entries.forEach(function (e) {
          byId[e.id] = e;
        });
        hitCanvases = list
          .map(function (s) {
            return byId[String(s.id)];
          })
          .filter(Boolean);
        bindPixelPointer();
      })
      .catch(function (err) {
        console.warn('BurnfolderSkins: hit mask load failed', err);
      });

    syncLatestEntryLink();
  }

  function bootFromQuery() {
    var q = readQuery();
    if (q.has('hitboxes')) {
      applyHitboxes(q.get('hitboxes') !== '0' && q.get('hitboxes') !== 'false');
    } else {
      try {
        if (localStorage.getItem(HITBOX_KEY) === '1') applyHitboxes(true);
      } catch (_) {}
    }

    if (q.has('skin')) {
      var requested = q.get('skin') || 'default';
      applySkin(requested === '' ? 'default' : requested);
    } else {
      applySkin(currentSkin(), { persist: false });
    }
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function watchBodyClass() {
    // No-op. A prior MutationObserver here called mountToggle/pinToGate on body
    // mutations and looped forever (tab spinner never finished).
  }

  window.BurnfolderSkins = {
    set: applySkin,
    toggle: toggleSkin,
    current: currentSkin,
    mountHotspots: mountHotspots,
    pinHomeGate: pinToGate,
    hitboxes: function (on) {
      if (typeof on === 'undefined') {
        return document.documentElement.getAttribute('data-hitboxes') === '1';
      }
      applyHitboxes(!!on);
      return !!on;
    },
    list: function () {
      return Object.keys(KNOWN);
    },
    setLink: function (id, href, label) {
      var list = window.BurnfolderSkinHotspots || [];
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) !== String(id)) continue;
        if (typeof href !== 'undefined') list[i].href = href;
        if (typeof label !== 'undefined') list[i].label = label;
        mountHotspots();
        return list[i];
      }
      return null;
    }
  };

  bootFromQuery();
  bindHotspotActions();
  bindHomeGate();
  onReady(function () {
    ensureSkinOutsideSpa();
    mountToggle();
    mountHotspots();
    bindSkinFit();
    watchBodyClass();
    pinToGate();

    var gateImg = document.querySelector('.skin-map--photonegative .skin-map__img');
    if (gateImg) {
      if (gateImg.complete) {
        pinToGate();
      } else {
        gateImg.addEventListener(
          'load',
          function () {
            pinToGate();
          },
          { once: true }
        );
      }
    }

    setTimeout(function () {
      ensureSkinOutsideSpa();
      mountToggle();
      mountHotspots();
      syncSkinFit();
      pinToGate();
    }, 0);
  });

  window.addEventListener('pageshow', function () {
    if (!isIndexHome()) return;
    scrollToAudioLock = false;
    touchStartY = null;
    var gate = getGate();
    if (gate) gate.hidden = false;
    ensureSkinOutsideSpa();
    syncSkinFit();
    mountHotspots();
    pinToGate();
    mountToggle();
  });
})();
