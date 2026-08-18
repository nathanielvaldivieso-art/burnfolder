/**
 * Engine contract for lock-screen / background queue advance.
 * Run: node test/playback-engine-lockscreen.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const muxSrc = fs.readFileSync(path.join(__dirname, '..', 'shared', 'mux-playback.js'), 'utf8');

function makeStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(k);
    }
  };
}

function createFakeMedia(kind) {
  const listeners = {};
  const attrs = {};
  const el = {
    tagName: kind,
    nodeName: kind,
    paused: true,
    ended: false,
    currentTime: 0,
    duration: 12,
    readyState: 4,
    playbackRate: 1,
    playCalls: 0,
    pauseCalls: 0,
    src: '',
    style: { cssText: '' },
    canPlayType: function (type) {
      if (kind !== 'AUDIO') return '';
      return String(type || '').indexOf('mpegurl') !== -1 ? 'probably' : '';
    },
    getAttribute: function (key) {
      if (key === 'src') return el.src || attrs.src || null;
      return Object.prototype.hasOwnProperty.call(attrs, key) ? attrs[key] : null;
    },
    setAttribute: function (key, value) {
      attrs[key] = String(value);
      if (key === 'src') el.src = String(value);
    },
    removeAttribute: function (key) {
      delete attrs[key];
      if (key === 'src') el.src = '';
    },
    addEventListener: function (type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener: function (type, fn) {
      listeners[type] = (listeners[type] || []).filter(function (cb) {
        return cb !== fn;
      });
    },
    fire: function (type) {
      (listeners[type] || []).slice().forEach(function (fn) {
        fn();
      });
    },
    play: function () {
      el.playCalls += 1;
      el.paused = false;
      el.ended = false;
      el.fire('play');
      el.fire('playing');
      return Promise.resolve();
    },
    pause: function () {
      el.pauseCalls += 1;
      el.paused = true;
      el.fire('pause');
    }
  };
  Object.defineProperty(el, 'src', {
    configurable: true,
    enumerable: true,
    get: function () {
      return attrs.src || '';
    },
    set: function (value) {
      attrs.src = String(value || '');
      el.ended = false;
      el.currentTime = 0;
      if (!el.paused) {
        el.paused = true;
        el.fire('pause');
      }
    }
  });
  return el;
}

function loadEngine(opts) {
  const options = opts || {};
  const nodes = Object.assign({}, options.nodes || {});
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  const mediaStates = [];
  const root = {
    localStorage: localStorage,
    sessionStorage: sessionStorage,
    document: {
      body: {
        classList: { contains: function () { return false; } },
        appendChild: function (el) {
          if (el && el.id) nodes[el.id] = el;
        },
        insertBefore: function (el) {
          if (el && el.id) nodes[el.id] = el;
        }
      },
      getElementById: function (id) {
        return nodes[id] || null;
      },
      createElement: function (tag) {
        const el = createFakeMedia(String(tag).toUpperCase());
        return el;
      },
      addEventListener: function () {},
      hidden: options.hidden === true
    },
    addEventListener: function () {},
    dispatchEvent: function () {
      return true;
    },
    setTimeout: function (fn, ms) {
      if (!ms) return setTimeout(fn, 0);
      return 0;
    },
    clearTimeout: function () {},
    setInterval: function () {
      return 0;
    },
    clearInterval: function () {},
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    navigator: {
      mediaSession: {
        metadata: null,
        playbackState: 'none',
        setActionHandler: function () {},
        setPositionState: function () {}
      }
    },
    Image: function Image() {
      this.onload = null;
      Object.defineProperty(this, 'src', {
        set: function () {}
      });
    },
    MediaMetadata: function MediaMetadata(data) {
      Object.assign(this, data);
    }
  };
  root.window = root;
  root.globalThis = root;
  root.BurnfolderMediaSession = {
    setMetadata: function (song, detail) {
      mediaStates.push({ kind: 'meta', playing: !!(detail && detail.playing), title: song && song.title });
    },
    setPlaybackState: function (playing) {
      mediaStates.push({ kind: 'state', playing: !!playing });
      root.navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    },
    setPositionState: function () {},
    bindActions: function (handlers) {
      root._mediaActions = handlers;
    }
  };

  vm.runInNewContext(muxSrc, root);
  return {
    root: root,
    nodes: nodes,
    mediaStates: mediaStates,
    create: function (createOpts) {
      return root.BurnfolderMuxPlayback.create(createOpts);
    }
  };
}

const queue = [
  { title: 'SOMETIMES', playbackId: 's1' },
  { title: 'FIRE ESCAPE', playbackId: 's2' },
  { title: 'PHOTO NEGATIVE', playbackId: 's3' },
  { title: 'IT DOESNT MATTER', playbackId: 'idm1' }
];

(function nativeHlsAdvanceDoesNotPause() {
  const live = createFakeMedia('AUDIO');
  live.canPlayType = function (type) {
    return String(type || '').indexOf('mpegurl') !== -1 ? 'probably' : '';
  };
  const harness = loadEngine({ nodes: { activeLiveAudio: live } });
  const engine = harness.create({
    getPlayer: function () {
      return live;
    },
    recall: false,
    restoreRecall: false
  });
  assert.ok(engine.playTrackQueue(queue, 0, { immediatePlay: true }));
  assert.strictEqual(engine.getActiveSong().playbackId, 's1');
  assert.ok(live.src.indexOf('s1') !== -1);
  const pausesAfterStart = live.pauseCalls;

  live.currentTime = 12;
  live.ended = true;
  live.fire('ended');
  assert.strictEqual(engine.getActiveSong().playbackId, 's2');
  assert.ok(live.src.indexOf('s2') !== -1, 'second track source applied');
  assert.strictEqual(live.pauseCalls, pausesAfterStart, 'handoff must not call pause()');
  assert.ok(live.playCalls >= 2, 'next track play() in the ended turn');

  live.currentTime = 12;
  live.ended = true;
  live.fire('ended');
  assert.strictEqual(engine.getActiveSong().playbackId, 's3');

  live.currentTime = 12;
  live.ended = true;
  live.fire('ended');
  assert.strictEqual(engine.getActiveSong().playbackId, 'idm1', 'crosses into the next collection/track');
  assert.ok(live.src.indexOf('idm1') !== -1);

  const pausedReported = harness.mediaStates.some(function (row) {
    return row.kind === 'state' && row.playing === false;
  });
  assert.strictEqual(pausedReported, false, 'media session stays playing across handoffs');
  engine.stop();
})();

(function leftoverEndedDoesNotSkip() {
  const player = createFakeMedia('MUX-PLAYER');
  player.canPlayType = function () {
    return '';
  };
  const harness = loadEngine({
    nodes: { activeMuxPlayer: player }
  });
  harness.root.document.createElement = function (tag) {
    const el = createFakeMedia(String(tag).toUpperCase());
    el.canPlayType = function () {
      return '';
    };
    return el;
  };
  player.play = function () {
    player.playCalls += 1;
    player.paused = false;
    return Promise.resolve();
  };
  const engine = harness.create({
    getPlayer: function () {
      return player;
    },
    recall: false,
    restoreRecall: false
  });
  engine.playTrackQueue(queue, 0, { immediatePlay: true });
  player.fire('playing');
  player.ended = true;
  player.currentTime = 12;
  player.fire('ended');
  assert.strictEqual(engine.getActiveSong().playbackId, 's2');
  assert.strictEqual(player.getAttribute('playback-id'), 's2');

  // mux-player can leave ended=true until the new source is actually playing.
  player.ended = true;
  player.currentTime = 12;
  player.duration = 12;
  player.paused = true;
  player.fire('timeupdate');
  assert.strictEqual(
    engine.getActiveSong().playbackId,
    's2',
    'sticky ended after swap must not skip the next track'
  );
  engine.stop();
})();

(function muxHlsUrlIsStable() {
  const harness = loadEngine();
  assert.strictEqual(
    harness.root.BurnfolderMuxPlayback.muxHlsUrl('abcXYZ'),
    'https://stream.mux.com/abcXYZ.m3u8'
  );
  assert.strictEqual(harness.root.BurnfolderMuxPlayback.LIVE_AUDIO_ID, 'activeLiveAudio');
})();

console.log('playback-engine-lockscreen: ok');
