/* Home music constellation — links dropdown + playback for the post-gate stage. */
(function () {
  'use strict';

  var linksBound = false;

  function normalizeLabel(label) {
    return String(label || '')
      .toLowerCase()
      .trim();
  }

  function collectHomeLinks() {
    var album =
      (window.burnfolderAlbumPages && window.burnfolderAlbumPages.photonegative) || null;
    var press = window.burnfolderPressPage || null;
    var byLabel = {};

    function add(link) {
      if (!link || !link.label) return;
      var key = normalizeLabel(link.label);
      if (!byLabel[key]) byLabel[key] = link;
      else if ((!byLabel[key].href || byLabel[key].pending) && link.href && !link.pending) {
        byLabel[key] = link;
      }
    }

    if (album && Array.isArray(album.links)) album.links.forEach(add);
    if (press && Array.isArray(press.links)) press.links.forEach(add);

    var preferred = ['spotify', 'apple music', 'youtube', 'tidal', 'instagram'];
    var out = [];
    preferred.forEach(function (key) {
      if (byLabel[key]) {
        out.push(byLabel[key]);
        delete byLabel[key];
      }
    });
    Object.keys(byLabel).forEach(function (key) {
      out.push(byLabel[key]);
    });
    return out;
  }

  function setLinksMenuOpen(open) {
    var toggle = document.getElementById('homeMusicLinksToggle');
    var list = document.getElementById('homeMusicLinksList');
    if (!toggle || !list) return;
    list.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && window.BurnfolderSiteMenu && window.BurnfolderSiteMenu.setOpen) {
      window.BurnfolderSiteMenu.setOpen(false);
    }
  }

  function mountLinks() {
    var root = document.getElementById('homeMusicLinks');
    var toggle = document.getElementById('homeMusicLinksToggle');
    var list = document.getElementById('homeMusicLinksList');
    if (!root || !toggle || !list) return;

    list.innerHTML = '';
    var links = collectHomeLinks();
    if (!links.length) {
      root.hidden = true;
      toggle.hidden = true;
      list.hidden = true;
      return;
    }

    root.hidden = false;
    toggle.hidden = false;
    list.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');

    links.forEach(function (link) {
      var href = (link.href || '').trim();
      var pending = !!link.pending || !href;
      var li = document.createElement('li');
      var item = document.createElement(pending ? 'span' : 'a');
      item.className = 'home-music__links-item' + (pending ? ' is-pending' : '');
      item.textContent = normalizeLabel(link.label);
      if (pending) {
        item.setAttribute('aria-disabled', 'true');
        item.title = link.label + ' — soon';
      } else {
        item.href = href;
        item.target = '_blank';
        item.rel = 'noopener noreferrer';
      }
      li.appendChild(item);
      list.appendChild(li);
    });
  }

  function bindLinksMenu() {
    if (linksBound) return;

    var toggle = document.getElementById('homeMusicLinksToggle');
    var list = document.getElementById('homeMusicLinksList');
    if (!toggle || !list) return;

    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      var open = list.hidden;
      if (window.BurnfolderSiteMenu && window.BurnfolderSiteMenu.setOpen) {
        window.BurnfolderSiteMenu.setOpen(false);
      }
      setLinksMenuOpen(open);
    });

    document.addEventListener('click', function (e) {
      if (!list.hidden && !e.target.closest('#homeMusicLinks')) {
        setLinksMenuOpen(false);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setLinksMenuOpen(false);
    });

    list.addEventListener('click', function (e) {
      if (e.target.closest('a')) setLinksMenuOpen(false);
    });

    linksBound = true;
  }

  function getTrackGroupKey(title) {
    var api = window.BurnfolderSongVersions;
    if (api && api.getTrackGroupKey) return api.getTrackGroupKey(title);
    return String(title || '')
      .toLowerCase()
      .trim();
  }

  var playbackBound = false;

  function bindPlayback() {
    if (!document.getElementById('homeMusic')) return;
    if (typeof window.getFeaturedMusicRelease !== 'function') return;
    if (typeof window.playTrackBySong !== 'function') return;

    var release = window.getFeaturedMusicRelease();
    if (!release || !Array.isArray(release.tracks) || !release.tracks.length) return;

    window.currentSongs = release.tracks.slice();

    var byKey = {};
    release.tracks.forEach(function (song) {
      var key = getTrackGroupKey(song.title);
      if (key && !byKey[key]) byKey[key] = song;
    });

    document.querySelectorAll('.home-music__song[data-group-key]').forEach(function (el) {
      if (el.dataset.homeMusicBound === '1') return;

      var key = (el.getAttribute('data-group-key') || '').toLowerCase().trim();
      var song = byKey[key];
      if (!song || !song.playbackId) return;

      el.dataset.playbackId = song.playbackId;
      el.dataset.homeMusicBound = '1';
      el.setAttribute('aria-label', 'Play ' + (el.textContent || '').trim());

      function onActivate(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        window.playTrackBySong(song);
      }

      var rowTap = window.BurnfolderTouchTap || window.BurnfolderStudioTap;
      if (rowTap && rowTap.bind) {
        rowTap.bind(el, onActivate);
      } else {
        el.addEventListener('click', onActivate);
      }
    });

    var pf = window.BurnfolderPlaybackPrefetch;
    if (pf && pf.prefetchList) pf.prefetchList(release.tracks);

    if (typeof window.syncTracklistPlayback === 'function') {
      window.syncTracklistPlayback();
    }

    playbackBound = true;
  }

  // Audio page → gate: opposite gesture from index scroll-to-audio
  // (finger/trackpad "scroll down" / wheel toward previous content).
  var returnBound = false;
  var returnLock = false;
  var returnTouchY = null;
  var returnArmed = false;

  function isAudioPage() {
    return !!(document.body && document.body.classList.contains('page-audio'));
  }

  function goToGatePage() {
    if (returnLock || !isAudioPage()) return;
    returnLock = true;
    window.location.assign('index.html');
  }

  function armReturnToGate() {
    returnArmed = false;
    window.scrollTo(0, 0);
    setTimeout(function () {
      window.scrollTo(0, 0);
      returnArmed = true;
    }, 150);
  }

  function bindReturnToGate() {
    if (returnBound || !isAudioPage()) return;
    returnBound = true;

    if ('scrollRestoration' in history) {
      try {
        history.scrollRestoration = 'manual';
      } catch (_) {}
    }

    window.addEventListener(
      'wheel',
      function (e) {
        if (!isAudioPage() || returnLock || !returnArmed) return;
        if ((window.scrollY || window.pageYOffset || 0) > 2) return;
        var dy = e.deltaY;
        if (Math.abs(dy) < 1 && Math.abs(e.deltaX) > Math.abs(dy)) dy = e.deltaX;
        // Opposite of gate→audio (which uses dy > 0)
        if (dy >= 0) return;
        e.preventDefault();
        goToGatePage();
      },
      { passive: false, capture: true }
    );

    window.addEventListener('keydown', function (e) {
      if (!isAudioPage() || returnLock || !returnArmed) return;
      if ((window.scrollY || window.pageYOffset || 0) > 2) return;
      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        goToGatePage();
      }
    });

    window.addEventListener(
      'touchstart',
      function (e) {
        if (!isAudioPage() || returnLock || !returnArmed) return;
        if ((window.scrollY || window.pageYOffset || 0) > 2) return;
        var touch = e.changedTouches && e.changedTouches[0];
        returnTouchY = touch ? touch.clientY : null;
      },
      { passive: true, capture: true }
    );

    window.addEventListener(
      'touchmove',
      function (e) {
        if (!isAudioPage() || returnLock || !returnArmed || returnTouchY == null) return;
        if ((window.scrollY || window.pageYOffset || 0) > 2) return;
        var touch = e.changedTouches && e.changedTouches[0];
        if (!touch) return;
        // Finger moves down = opposite of gate→audio swipe
        if (touch.clientY - returnTouchY < 40) return;
        e.preventDefault();
        returnTouchY = null;
        goToGatePage();
      },
      { passive: false, capture: true }
    );

    window.addEventListener(
      'touchend',
      function () {
        returnTouchY = null;
      },
      { passive: true, capture: true }
    );

    window.addEventListener(
      'touchcancel',
      function () {
        returnTouchY = null;
      },
      { passive: true, capture: true }
    );

    window.addEventListener('load', armReturnToGate);
    if (document.readyState === 'complete') armReturnToGate();
    else if (document.readyState !== 'loading') armReturnToGate();
  }

  function init() {
    bindLinksMenu();
    mountLinks();
    bindPlayback();
    bindReturnToGate();
  }

  window.BurnfolderHomeMusic = {
    mountLinks: mountLinks,
    mountDsp: mountLinks,
    bindPlayback: bindPlayback
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('burnfolder-spa-navigated', function () {
    returnLock = false;
    returnTouchY = null;
    mountLinks();
    if (!playbackBound) bindPlayback();
    else if (typeof window.syncTracklistPlayback === 'function') {
      window.syncTracklistPlayback();
    }
    bindReturnToGate();
    if (isAudioPage()) armReturnToGate();
  });
})();
