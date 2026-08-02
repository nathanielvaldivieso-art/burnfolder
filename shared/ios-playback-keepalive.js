/**
 * Keep Studio/site JS awake on iOS lock screen while a queue is playing.
 *
 * iOS suspends timers and media events when the PWA is backgrounded. A live
 * ScriptProcessorNode (and tiny silent <audio> loop fallback) keeps the
 * WebContent process eligible to run handoff logic so albums can advance.
 *
 * Start from a user gesture / active play() chain. No-ops off iOS.
 */
(function (root) {
  'use strict';

  var audioCtx = null;
  var processor = null;
  var silentGain = null;
  var silentAudio = null;
  var running = false;
  var tickHandlers = [];
  var lastTickAt = 0;

  // 0.05s of silence, mono 8kHz WAV.
  var SILENT_WAV =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

  function isLikelyIos() {
    if (typeof navigator === 'undefined') return false;
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOS desktop UA
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function emitTick() {
    lastTickAt = Date.now();
    for (var i = 0; i < tickHandlers.length; i++) {
      try {
        tickHandlers[i](lastTickAt);
      } catch (e) {
        /* noop */
      }
    }
  }

  function ensureSilentAudio() {
    if (silentAudio || typeof document === 'undefined') return silentAudio;
    silentAudio = document.getElementById('bfIosKeepaliveAudio');
    if (!silentAudio) {
      silentAudio = document.createElement('audio');
      silentAudio.id = 'bfIosKeepaliveAudio';
      silentAudio.setAttribute('playsinline', '');
      silentAudio.setAttribute('preload', 'auto');
      silentAudio.loop = true;
      silentAudio.src = SILENT_WAV;
      silentAudio.volume = 0.01;
      silentAudio.style.cssText =
        'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(silentAudio);
    }
    return silentAudio;
  }

  function startAudioContextKeepalive() {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    if (!audioCtx) {
      try {
        audioCtx = new AC();
      } catch (e) {
        return false;
      }
    }
    if (audioCtx.state === 'suspended') {
      try {
        audioCtx.resume();
      } catch (e) {
        /* noop */
      }
    }
    if (processor) return true;
    try {
      // Deprecated, but still the reliable iOS lock-screen JS keep-alive.
      processor = audioCtx.createScriptProcessor(1024, 1, 1);
      silentGain = audioCtx.createGain();
      silentGain.gain.value = 0.0001;
      processor.onaudioprocess = function () {
        emitTick();
      };
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);
      return true;
    } catch (e) {
      processor = null;
      return false;
    }
  }

  function startSilentAudioKeepalive() {
    var el = ensureSilentAudio();
    if (!el) return false;
    var playPromise = el.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(function () {});
    }
    return true;
  }

  function start(opts) {
    var options = opts || {};
    var force = options.force === true;
    if (!force && !isLikelyIos()) {
      // Desktop: mark running so callers can attach tick handlers in tests.
      running = true;
      return true;
    }
    startAudioContextKeepalive();
    // Silent <audio> only while backgrounded — keeps AVAudioSession warm for
    // the next-track play() without mixing a second stream in the foreground.
    if (typeof document !== 'undefined' && document.hidden) {
      startSilentAudioKeepalive();
    }
    running = true;
    return true;
  }

  function stop() {
    running = false;
    if (processor) {
      try {
        processor.disconnect();
      } catch (e) {
        /* noop */
      }
      processor.onaudioprocess = null;
      processor = null;
    }
    if (silentGain) {
      try {
        silentGain.disconnect();
      } catch (e) {
        /* noop */
      }
      silentGain = null;
    }
    if (audioCtx) {
      try {
        audioCtx.suspend();
      } catch (e) {
        /* noop */
      }
    }
    if (silentAudio) {
      try {
        silentAudio.pause();
      } catch (e) {
        /* noop */
      }
    }
  }

  function pulse() {
    if (!running) start({ force: true });
    if (audioCtx && audioCtx.state === 'suspended') {
      try {
        audioCtx.resume();
      } catch (e) {
        /* noop */
      }
    }
    if (typeof document !== 'undefined' && document.hidden) {
      startSilentAudioKeepalive();
    } else if (silentAudio) {
      try {
        silentAudio.pause();
      } catch (e) {
        /* noop */
      }
    }
    emitTick();
  }

  function onTick(fn) {
    if (typeof fn !== 'function') return function () {};
    tickHandlers.push(fn);
    return function () {
      tickHandlers = tickHandlers.filter(function (handler) {
        return handler !== fn;
      });
    };
  }

  root.BurnfolderIosPlaybackKeepalive = {
    isLikelyIos: isLikelyIos,
    start: start,
    stop: stop,
    pulse: pulse,
    onTick: onTick,
    isRunning: function () {
      return running;
    },
    lastTickAt: function () {
      return lastTickAt;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
