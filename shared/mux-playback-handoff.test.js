/**
 * Node simulation of lock-screen dual-player handoff decisions.
 * Run: node shared/mux-playback-handoff.test.js
 */
'use strict';

var fails = 0;
function assert(name, cond) {
  if (!cond) {
    fails += 1;
    console.error('FAIL', name);
  } else {
    console.log('ok', name);
  }
}

var DUAL_HANDOFF_REMAINING_SEC = 0.22;

function remainingSeconds(player) {
  var duration = Number(player.duration);
  var current = Number(player.currentTime);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) return NaN;
  return duration - current;
}

function trackFinished(player, hidden) {
  if (!player) return false;
  if (player.ended) return true;
  var remaining = remainingSeconds(player);
  if (!Number.isFinite(remaining)) return false;
  if (!hidden) return false;
  if (remaining <= 0.15) return true;
  if (player.paused && remaining <= 0.75) return true;
  return false;
}

function shouldDualHandoff(player, hidden, hasNext, locks) {
  if (locks.queueAdvanceLock || locks.dualHandoffInFlight || !player || !hasNext) return false;
  if (trackFinished(player, hidden) || player.ended) return true;
  var remaining = remainingSeconds(player);
  if (!Number.isFinite(remaining)) return false;
  if (hidden && !player.paused && remaining <= DUAL_HANDOFF_REMAINING_SEC) return true;
  return false;
}

function simulateHandoff(opts) {
  var primaryPlaying = true;
  var standbyPlaying = false;
  var pausedPrimaryFirst = false;
  // Correct order: play standby, then pause primary.
  standbyPlaying = true;
  if (opts.pausePrimaryFirst) {
    primaryPlaying = false;
    pausedPrimaryFirst = true;
    // iOS would reject standby.play() here; model that failure.
    if (opts.hidden) standbyPlaying = false;
  } else {
    primaryPlaying = false;
  }
  return {
    success: standbyPlaying,
    pausedPrimaryFirst: pausedPrimaryFirst,
    swapped: standbyPlaying && !primaryPlaying
  };
}

// Visible: no early cut at 1s remaining
assert(
  'visible no early handoff at 1s',
  !shouldDualHandoff(
    { ended: false, paused: false, duration: 100, currentTime: 99 },
    false,
    true,
    {}
  )
);

// Visible: ended advances
assert(
  'visible ended handoff',
  shouldDualHandoff(
    { ended: true, paused: true, duration: 100, currentTime: 100 },
    false,
    true,
    {}
  )
);

// Hidden: early dual at 0.2s while still playing
assert(
  'hidden early dual at 0.2s',
  shouldDualHandoff(
    { ended: false, paused: false, duration: 100, currentTime: 99.85 },
    true,
    true,
    {}
  )
);

// Hidden: do not early dual at 2s (would chop outro)
assert(
  'hidden no dual at 2s left',
  !shouldDualHandoff(
    { ended: false, paused: false, duration: 100, currentTime: 98 },
    true,
    true,
    {}
  )
);

// Hidden: paused near end
assert(
  'hidden paused near end',
  shouldDualHandoff(
    { ended: false, paused: true, duration: 100, currentTime: 99.5 },
    true,
    true,
    {}
  )
);

// Cross-collection queue
function collectionQueue(groups, openId) {
  var start = groups.findIndex(function (g) {
    return g.id === openId;
  });
  var rows = [];
  for (var i = start; i < groups.length; i++) rows = rows.concat(groups[i].tracks);
  return rows;
}
var groups = [
  { id: 'a', tracks: ['1', '2'] },
  { id: 'b', tracks: ['3'] }
];
assert('cross collection', collectionQueue(groups, 'a').join(',') === '1,2,3');

// Handoff order
var good = simulateHandoff({ hidden: true, pausePrimaryFirst: false });
assert('play standby before pause', good.success && good.swapped && !good.pausedPrimaryFirst);
var bad = simulateHandoff({ hidden: true, pausePrimaryFirst: true });
assert('pause-first fails when locked', !bad.success);

if (fails) {
  console.error(fails + ' failed');
  process.exit(1);
}
console.log('all handoff tests passed');
