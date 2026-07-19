/* Site skins — toggle without destroying the default layout.
   Usage:
     BurnfolderSkins.set('photonegative')
     BurnfolderSkins.set('default')
     ?skin=photonegative | ?skin=default
     ?hitboxes=1  (outline hotspot regions)
*/
(function () {
  'use strict';

  var STORAGE_KEY = 'bf-skin';
  var HITBOX_KEY = 'bf-hitboxes';
  var KNOWN = { default: true, photonegative: true };

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

    // Keep outside #spa-content so SPA swaps don't destroy it
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
    var link = document.querySelector('[data-skin-hotspot="latest-entry"]');
    if (!link) return;
    var entries = window.journalEntries;
    if (entries && entries.length) {
      link.setAttribute('href', entries[0] + '.html');
    } else {
      link.setAttribute('href', 'index.html');
    }
  }

  function bindHotspotActions() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-skin-set]');
      if (!el) return;
      var next = el.getAttribute('data-skin-set');
      if (!next || !KNOWN[next]) return;
      e.preventDefault();
      e.stopPropagation();
      applySkin(next);
    });
  }

  // SVG :hover is unreliable (transparent fills, overlapping spots).
  // Drive the music trace from pointer events on the hit shape itself.
  var musicHoverBound = false;
  function bindMusicHover() {
    var spot = document.querySelector('.skin-map__spot--music');
    if (!spot || musicHoverBound) return;
    var hit = spot.querySelector('.skin-map__hit--music') || spot.querySelector('.skin-map__hit');
    if (!hit) return;
    musicHoverBound = true;

    function on() {
      spot.classList.add('is-hot');
    }
    function off() {
      spot.classList.remove('is-hot');
    }

    hit.addEventListener('pointerenter', on);
    hit.addEventListener('pointerleave', off);
    spot.addEventListener('focusin', on);
    spot.addEventListener('focusout', off);
  }

  // Keep SVG hitboxes + trace warped the same way as the photo.
  // CSS can set object-fit; preserveAspectRatio must be set on the SVG nodes.
  function syncSkinFit() {
    var map = document.querySelector('.skin-map--photonegative');
    if (!map) return;
    var svg = map.querySelector('.skin-map__svg');
    if (!svg) return;
    var fill = window.matchMedia('(max-width: 600px)').matches;
    var mode = fill ? 'none' : 'xMidYMid slice';
    svg.setAttribute('preserveAspectRatio', mode);
    map.querySelectorAll('.skin-map__trace').forEach(function (img) {
      img.setAttribute('preserveAspectRatio', mode);
    });
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

  // Re-sync after SPA body class / content swaps
  var bodyClassObserver = null;
  function watchBodyClass() {
    if (bodyClassObserver || !document.body) return;
    bodyClassObserver = new MutationObserver(function () {
      syncToggleLabel();
      syncLatestEntryLink();
      musicHoverBound = false;
      bindMusicHover();
      syncSkinFit();
      mountToggle();
    });
    bodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true, subtree: false });
  }

  window.BurnfolderSkins = {
    set: applySkin,
    toggle: toggleSkin,
    current: currentSkin,
    hitboxes: function (on) {
      if (typeof on === 'undefined') {
        return document.documentElement.getAttribute('data-hitboxes') === '1';
      }
      applyHitboxes(!!on);
      return !!on;
    },
    list: function () {
      return Object.keys(KNOWN);
    }
  };

  bootFromQuery();
  bindHotspotActions();
  onReady(function () {
    mountToggle();
    syncLatestEntryLink();
    bindMusicHover();
    bindSkinFit();
    watchBodyClass();
    // spa-router wraps body on DOMContentLoaded — remount after it runs
    setTimeout(function () {
      mountToggle();
      musicHoverBound = false;
      bindMusicHover();
      syncSkinFit();
    }, 0);
  });
})();
