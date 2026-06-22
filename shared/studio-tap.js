/**
 * Reliable tap handling for studio UI on touch devices.
 * Fires on touchend for quick taps; suppresses duplicate click synthesis.
 */
(function (root) {
  'use strict';

  function on(container, selector, handler) {
    if (!container || !selector || typeof handler !== 'function') return;

    let touchMoved = false;
    let touchHandledAt = 0;

    container.addEventListener(
      'touchstart',
      function (event) {
        const match = event.target.closest(selector);
        if (!match || !container.contains(match)) return;
        touchMoved = false;
      },
      { passive: true }
    );

    container.addEventListener(
      'touchmove',
      function () {
        touchMoved = true;
      },
      { passive: true }
    );

    container.addEventListener('touchend', function (event) {
      const match = event.target.closest(selector);
      if (!match || !container.contains(match)) return;
      if (touchMoved) return;
      touchHandledAt = Date.now();
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      handler(event, match);
    });

    container.addEventListener('click', function (event) {
      const match = event.target.closest(selector);
      if (!match || !container.contains(match)) return;
      if (Date.now() - touchHandledAt < 600) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      handler(event, match);
    });
  }

  function bind(el, handler) {
    if (!el || typeof handler !== 'function') return;

    let touchMoved = false;
    let touchHandledAt = 0;

    el.addEventListener(
      'touchstart',
      function () {
        touchMoved = false;
      },
      { passive: true }
    );

    el.addEventListener(
      'touchmove',
      function () {
        touchMoved = true;
      },
      { passive: true }
    );

    el.addEventListener('touchend', function (event) {
      if (touchMoved) return;
      touchHandledAt = Date.now();
      if (event.cancelable) event.preventDefault();
      handler(event);
    });

    el.addEventListener('click', function (event) {
      if (Date.now() - touchHandledAt < 600) {
        event.preventDefault();
        return;
      }
      handler(event);
    });
  }

  root.BurnfolderStudioTap = {
    on: on,
    bind: bind
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
