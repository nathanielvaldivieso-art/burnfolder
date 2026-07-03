/**
 * Reliable tap handling for touch devices (studio + public site).
 * Fires play/actions on touchend inside the user-gesture window (required on iOS).
 * Uses movement slop so elastic scroll does not cancel taps in PWA standalone mode.
 */
(function (root) {
  'use strict';

  var TAP_SLOP_PX = 10;

  function movedBeyondSlop(startX, startY, x, y) {
    return Math.hypot(x - startX, y - startY) > TAP_SLOP_PX;
  }

  function touchPoint(event) {
    var t = (event.changedTouches && event.changedTouches[0]) || (event.touches && event.touches[0]);
    return t || null;
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

    var active = null;

    container.addEventListener(
      'touchstart',
      function (event) {
        if (shouldSkip(event)) return;
        var match = event.target.closest(selector);
        if (!match || !container.contains(match)) return;
        var t = touchPoint(event);
        if (!t) return;
        active = { el: match, startX: t.clientX, startY: t.clientY, moved: false };
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
      var match = event.target.closest(selector);
      if (!match || match !== active.el || !container.contains(match)) {
        active = null;
        return;
      }
      if (shouldSkip(event) || active.moved) {
        active = null;
        return;
      }
      var touchHandledAt = Date.now();
      container.dataset.bfLastTapAt = String(touchHandledAt);
      active = null;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      handler(event, match);
    });

    container.addEventListener('click', function (event) {
      var match = event.target.closest(selector);
      if (!match || !container.contains(match)) return;
      if (shouldSkip(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      var last = Number(container.dataset.bfLastTapAt || 0);
      if (Date.now() - last < 600) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      handler(event, match);
    });
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

    var startX = 0;
    var startY = 0;
    var touchMoved = false;
    var touchHandledAt = 0;

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
      touchHandledAt = Date.now();
      if (event.cancelable) event.preventDefault();
      handler(event);
      var guard = root.BurnfolderPlaybackScrollGuard;
      if (guard && guard.blurControl) guard.blurControl(el);
    });

    el.addEventListener('click', function (event) {
      if (shouldSkip(event)) {
        event.preventDefault();
        return;
      }
      if (Date.now() - touchHandledAt < 600) {
        event.preventDefault();
        return;
      }
      handler(event);
      var guardClick = root.BurnfolderPlaybackScrollGuard;
      if (guardClick && guardClick.blurControl) guardClick.blurControl(el);
    });
  }

  var api = {
    on: on,
    bind: bind,
    TAP_SLOP_PX: TAP_SLOP_PX
  };

  root.BurnfolderStudioTap = api;
  root.BurnfolderTouchTap = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
