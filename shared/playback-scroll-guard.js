/**
 * Preserve document scroll position across playback chrome changes.
 * iOS scrolls the viewport when fixed bars appear, focus moves, or the hidden
 * player is positioned off-screen — this module pins scroll during those updates.
 */
(function (root) {
  'use strict';

  const HIDDEN_PLAYER_PIN_STYLE =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;clip:rect(0,0,0,0);';

  function capture() {
    return {
      x: root.scrollX || 0,
      y: root.scrollY || 0
    };
  }

  function restore(pos) {
    if (!pos) return;
    if ((root.scrollX || 0) !== pos.x || (root.scrollY || 0) !== pos.y) {
      root.scrollTo(pos.x, pos.y);
    }
  }

  function run(mutator) {
    if (typeof mutator !== 'function') return;
    const pos = capture();
    mutator();
    restore(pos);
    root.requestAnimationFrame(function () {
      restore(pos);
      root.requestAnimationFrame(function () {
        restore(pos);
      });
    });
  }

  function afterPlay(mutator) {
    if (typeof mutator !== 'function') return;
    const pos = capture();
    mutator();
    restore(pos);
    root.requestAnimationFrame(function () {
      restore(pos);
    });
    root.setTimeout(function () {
      restore(pos);
    }, 0);
    root.setTimeout(function () {
      restore(pos);
    }, 48);
  }

  function pinHiddenPlayer(player) {
    if (!player || !player.style) return;
    player.style.cssText = HIDDEN_PLAYER_PIN_STYLE;
    player.setAttribute('playsinline', '');
    if (!player.hasAttribute('audio')) player.setAttribute('audio', '');
  }

  function blurControl(el) {
    if (!el || typeof el.blur !== 'function') return;
    try {
      el.blur();
    } catch (e) {
      /* ignore */
    }
  }

  root.BurnfolderPlaybackScrollGuard = {
    capture: capture,
    restore: restore,
    run: run,
    afterPlay: afterPlay,
    pinHiddenPlayer: pinHiddenPlayer,
    blurControl: blurControl,
    HIDDEN_PLAYER_PIN_STYLE: HIDDEN_PLAYER_PIN_STYLE
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
