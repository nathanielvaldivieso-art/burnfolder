/**
 * Smoke: playback recall survives "close" via localStorage (not sessionStorage).
 * Run: node test/playback-persist-smoke.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const recallSrc = fs.readFileSync(
  path.join(__dirname, '..', 'shared', 'playback-recall.js'),
  'utf8'
);
const muxSrc = fs.readFileSync(path.join(__dirname, '..', 'shared', 'mux-playback.js'), 'utf8');
const stackSrc = fs.readFileSync(
  path.join(__dirname, '..', 'shared', 'studio-playback-stack.js'),
  'utf8'
);

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
    },
    _map: map
  };
}

const localStorage = makeStorage();
const sessionStorage = makeStorage();
const root = {
  localStorage,
  sessionStorage,
  document: {
    body: null,
    getElementById() {
      return null;
    },
    hidden: true
  },
  addEventListener() {},
  dispatchEvent() {
    return true;
  },
  setTimeout,
  clearTimeout,
  CustomEvent: function CustomEvent(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  }
};
root.globalThis = root;
root.window = root;

vm.runInNewContext(recallSrc, root);
vm.runInNewContext(stackSrc, root);
vm.runInNewContext(muxSrc, root);

assert.ok(root.BurnfolderPlaybackRecall, 'recall API mounted');
assert.ok(root.BurnfolderStudioPlaybackStack, 'playback stack mounted');
assert.ok(root.BurnfolderMuxPlayback, 'mux playback mounted');
assert.strictEqual(
  root.BurnfolderStudioPlaybackStack.BRIDGE_PLAYER_ID,
  'bridgeMuxPlayer',
  'bridge player id present'
);
assert.ok(
  stackSrc.includes('bridgeMuxPlayer'),
  'shell markup includes bridge mux-player'
);
assert.ok(muxSrc.includes('beginBridgeHandoff'), 'ping-pong handoff implemented');
assert.ok(muxSrc.includes('unlockStandbyPlayerForIos'), 'standby iOS unlock present');
assert.ok(muxSrc.includes('pingpongInFlight'), 'ping-pong lock guard present');
assert.ok(muxSrc.includes('PINGPONG_LEAD_HIDDEN_SEC'), 'locked lead window present');
assert.ok(
  !/seekbackward:\s*function/.test(muxSrc),
  'media session seek handlers omitted for iOS next/prev'
);
/* Locked advances must not fall back to same-element reload. */
assert.ok(
  muxSrc.includes('Never fall back to reloading') ||
    muxSrc.includes('NEVER fall back to reloading'),
  'documents no same-element fallback while locked'
);

const song = { title: 'PHOTO NEGATIVE', playbackId: 'pn-playback-id', coverArt: '/x.jpg' };
const queue = [
  { title: 'SOMETIMES', playbackId: 's1' },
  { title: 'FIRE ESCAPE', playbackId: 's2' },
  song,
  { title: 'IT DOESNT MATTER', playbackId: 's4' }
];

root.BurnfolderPlaybackRecall.save({
  song,
  queue,
  queueIdx: 2,
  currentTime: 42.5,
  wasPlaying: true
});

assert.ok(localStorage.getItem('burnfolderPlaybackRecall'), 'saved to localStorage');
assert.strictEqual(
  sessionStorage.getItem('burnfolderPlaybackRecall'),
  null,
  'does not require sessionStorage'
);

/* Simulate iOS closing the PWA: sessionStorage wiped, localStorage kept. */
sessionStorage._map.clear();

const loaded = root.BurnfolderPlaybackRecall.load(1000 * 60 * 60 * 12);
assert.ok(loaded, 'recall loads after session wipe');
assert.strictEqual(loaded.song.playbackId, 'pn-playback-id');
assert.strictEqual(loaded.queue.length, 4);
assert.strictEqual(loaded.queueIdx, 2);
assert.strictEqual(loaded.currentTime, 42.5);
assert.strictEqual(loaded.wasPlaying, true);
assert.strictEqual(loaded.song.coverArt, '/x.jpg');

/* Migrate legacy sessionStorage → localStorage */
localStorage._map.clear();
sessionStorage.setItem(
  'burnfolderPlaybackRecall',
  JSON.stringify({
    song: { title: 'legacy', playbackId: 'leg1' },
    queue: [{ title: 'legacy', playbackId: 'leg1' }],
    queueIdx: 0,
    currentTime: 1,
    wasPlaying: false,
    savedAt: Date.now()
  })
);
const migrated = root.BurnfolderPlaybackRecall.load();
assert.ok(migrated, 'migrates legacy session recall');
assert.strictEqual(migrated.song.playbackId, 'leg1');
assert.ok(localStorage.getItem('burnfolderPlaybackRecall'), 'writes migrated row to localStorage');

console.log('playback-persist-smoke: ok');
