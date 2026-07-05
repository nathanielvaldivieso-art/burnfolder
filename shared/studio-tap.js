/**
 * Unified tap handling — studio + public site.
 *
 * Every target gets a native click handler (desktop + fallback).
 * Coarse pointer also gets touchend inside the iOS user-gesture window.
 */
(function (root) {
  'use strict';

  var TAP_SLOP_PX = 10;
  var COARSE_SLOP_PX = 14;
  var CLICK_DEDUPE_MS = 500;

  function isCoarsePointer() {
    if (!root.matchMedia) return false;
    return root.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }

  function slopPx() {
    return isCoarsePointer() ? COARSE_SLOP_PX : TAP_SLOP_PX;
  }

  function movedBeyondSlop(startX, startY, x, y) {
    return Math.hypot(x - startX, y - startY) > slopPx();
  }

  function touchPoint(event) {
    var t =
      (event.changedTouches && event.changedTouches[0]) ||
      (event.touches && event.touches[0]);
    return t || null;
  }

  function runHandler(handler, event, el) {
    if (typeof handler !== 'function') return;
    if (el === undefined) handler(event);
    else handler(event, el);
  }

  function bind(el, handler, options) {
    if (!el || typeof handler !== 'function') return;
    var opts = options || {};
    var shouldSkip =
      typeof opts.shouldSkip === 'function'
        ? opts.shouldSkip
        : function () {
            return false;
          };

    var handledAt = 0;

    el.addEventListener('click', function (event) {
      if (shouldSkip(event)) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (Date.now() - handledAt < CLICK_DEDUPE_MS) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        return;
      }
      handledAt = Date.now();
      runHandler(handler, event);
    });

    if (!isCoarsePointer()) return;

    var startX = 0;
    var startY = 0;
    var touchMoved = false;

    el.addEventListener(
      'touchstart',
      function (event) {
        if (shouldSkip(event)) return;
        var t = touchPoint(event);
        if (!t) return;
        startX = t.clientX;
        startY = t.clientY;
        touchMoved = false;
      },
      { passive: true }
    );

    el.addEventListener(
      'touchmove',
      function (event) {
        var t = touchPoint(event);
        if (!t) return;
        if (movedBeyondSlop(startX, startY, t.clientX, t.clientY)) {
          touchMoved = true;
        }
      },
      { passive: true }
    );

    el.addEventListener('touchend', function (event) {
      if (shouldSkip(event) || touchMoved) return;
      handledAt = Date.now();
      if (event.cancelable) event.preventDefault();
      runHandler(handler, event);
    });
  }

  function on(container, selector, handler, options) {
    if (!container || !selector || typeof handler !== 'function') return;
    var opts = options || {};
    var shouldSkip =
      typeof opts.shouldSkip === 'function'
        ? opts.shouldSkip
        : function () {
            return false;
          };

    function matchTarget(event) {
      var node = event.target && event.target.closest(selector);
      if (!node || !container.contains(node)) return null;
      return node;
    }

    var handledAt = 0;

    container.addEventListener('click', function (event) {
      var match = matchTarget(event);
      if (!match) return;
      if (shouldSkip(event, match)) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (Date.now() - handledAt < CLICK_DEDUPE_MS) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        return;
      }
      handledAt = Date.now();
      runHandler(handler, event, match);
    });

    if (!isCoarsePointer()) return;

    var active = null;

    container.addEventListener(
      'touchstart',
      function (event) {
        if (shouldSkip(event)) return;
        var match = matchTarget(event);
        if (!match) return;
        var t = touchPoint(event);
        if (!t) return;
        active = {
          el: match,
          startX: t.clientX,
          startY: t.clientY,
          moved: false
        };
      },
      { passive: true }
    );

    container.addEventListener(
      'touchmove',
      function (event) {
        if (!active) return;
        var t = touchPoint(event);
        if (!t) return;
        if (movedBeyondSlop(active.startX, active.startY, t.clientX, t.clientY)) {
          active.moved = true;
        }
      },
      { passive: true }
    );

    container.addEventListener('touchend', function (event) {
      if (!active) return;
      var match = matchTarget(event);
      if (!match || match !== active.el || !container.contains(match)) {
        active = null;
        return;
      }
      if (shouldSkip(event, match) || active.moved) {
        active = null;
        return;
      }
      handledAt = Date.now();
      container.dataset.bfLastTapAt = String(handledAt);
      active = null;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      runHandler(handler, event, match);
    });
  }

  var api = {
    on: on,
    bind: bind,
    isCoarsePointer: isCoarsePointer,
    TAP_SLOP_PX: TAP_SLOP_PX,
    COARSE_SLOP_PX: COARSE_SLOP_PX
  };

  root.BurnfolderStudioTap = api;
  root.BurnfolderTouchTap = api;

  if (!root.BurnfolderDisableInputAutocorrect) {
    var scripts = root.document.getElementsByTagName('script');
    var tapSrc = '';
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && /studio-tap\.js/.test(scripts[i].src)) {
        tapSrc = scripts[i].src;
        break;
      }
    }
    var loader = root.document.createElement('script');
    loader.src = tapSrc
      ? tapSrc.replace(/studio-tap\.js.*$/, 'disable-input-autocorrect.js?v=20260705b')
      : 'shared/disable-input-autocorrect.js?v=20260705b';
    root.document.head.appendChild(loader);
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
