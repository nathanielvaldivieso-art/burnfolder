/**
 * First-party site analytics (P16–P18).
 * Privacy-light: anonymous session id, no emails/fingerprints.
 * Tracks page pathways per session for the studio leaderboard.
 */
(function (root) {
  'use strict';

  var SESSION_KEY = 'bf_analytics_sid';
  var LAND_KEY = 'bf_analytics_land';
  var UTM_KEY = 'bf_analytics_utm';
  var PATH_KEY = 'bf_analytics_path';
  var PATH_SENT_KEY = 'bf_analytics_path_sent';
  var FLUSH_MS = 1500;
  var HEARTBEAT_MS = 1000;
  var MAX_QUEUE = 60;
  var MAX_PATH_STEPS = 8;
  var SEEK_BACK_SEC = 1.5;
  var MAX_HEAT_SECONDS = 20 * 60;
  // Stop retrying forever when ingest is down (keeps Safari / browser MCP "busy").
  var MAX_FLUSH_FAILURES = 2;

  var queue = [];
  var heatBuffer = {}; // groupKey -> { meta, duration, counts: {sec: n}, listenSeconds }
  var flushTimer = null;
  var heartbeatTimer = null;
  var active = null;
  var started = false;
  var lastTrackedPage = '';
  var flushInFlight = false;
  var flushFailStreak = 0;
  var ingestDisabled = false;

  function isLocalHost(host) {
    return host === 'localhost' || host === '127.0.0.1';
  }

  // python `npm run dev` (:8765) has no Netlify functions. Pointing at :8888 while
  // nothing listens there leaves pending beacons/fetches that never settle.
  function isStaticLocalServer() {
    var host = (root.location && root.location.hostname) || '';
    if (!isLocalHost(host)) return false;
    var port = (root.location && root.location.port) || '';
    return !!port && port !== '8888';
  }

  function apiBase() {
    return '/.netlify/functions';
  }

  function shouldTrack() {
    var host = (root.location && root.location.hostname) || '';
    var path = (root.location && root.location.pathname) || '';
    if (!/(^|\.)burnfolder\.com$/i.test(host) && !isLocalHost(host)) {
      return false;
    }
    if (isStaticLocalServer()) return false;
    if (path.indexOf('/studio/') === 0) return false;
    if (ingestDisabled) return false;
    return true;
  }

  function sessionId() {
    try {
      var existing = root.sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      var id =
        's_' +
        Math.random().toString(36).slice(2, 10) +
        Date.now().toString(36);
      root.sessionStorage.setItem(SESSION_KEY, id);
      return id;
    } catch (e) {
      return 's_anon';
    }
  }

  function pagePath() {
    var path = (root.location && root.location.pathname) || '/';
    var search = (root.location && root.location.search) || '';
    var params = new URLSearchParams(search);
    var keep = [];
    ['album', 'song', 't', 'entry'].forEach(function (key) {
      if (params.has(key)) keep.push(key + '=' + params.get(key));
    });
    return path + (keep.length ? '?' + keep.join('&') : '');
  }

  function shortLabel(page) {
    var raw = String(page || '/');
    var pathOnly = raw.split('?')[0] || '/';
    var file = pathOnly.split('/').pop() || '';
    var query = raw.indexOf('?') >= 0 ? raw.slice(raw.indexOf('?') + 1) : '';
    var params = new URLSearchParams(query);

    if (!file || file === 'index.html') return 'home';
    if (file === 'album.html') {
      return params.get('album') ? 'album:' + params.get('album') : 'album';
    }
    if (file === 'song.html') {
      return params.get('song') ? 'song:' + params.get('song') : 'song';
    }
    if (file === 'audio.html') return 'audio';
    if (file === 'music.html') return 'music';
    if (file === 'shop.html') return 'shop';
    if (file === 'press.html') return 'press';
    if (file === 'content.html') return 'visual';
    if (file === 'cart.html') return 'cart';
    if (file === 'checkout.html') return 'checkout';
    if (file === 'success.html') return 'success';
    if (file === 'listen.html') return 'share';
    if (/^\d{1,2}\.\d{1,2}\.\d{2}\.html$/.test(file)) {
      return 'journal:' + file.replace(/\.html$/, '');
    }
    return file.replace(/\.html$/, '') || 'page';
  }

  function loadPath() {
    try {
      var raw = root.sessionStorage.getItem(PATH_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function savePath(steps) {
    try {
      root.sessionStorage.setItem(PATH_KEY, JSON.stringify(steps || []));
    } catch (e) {
      /* noop */
    }
  }

  function pathAlreadySent(signature) {
    try {
      return root.sessionStorage.getItem(PATH_SENT_KEY) === signature;
    } catch (e) {
      return false;
    }
  }

  function markPathSent(signature) {
    try {
      root.sessionStorage.setItem(PATH_SENT_KEY, signature);
    } catch (e) {
      /* noop */
    }
  }

  function readUtm() {
    try {
      var cached = root.sessionStorage.getItem(UTM_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      /* noop */
    }
    var params = new URLSearchParams((root.location && root.location.search) || '');
    var utm = {
      source: params.get('utm_source') || '',
      medium: params.get('utm_medium') || '',
      campaign: params.get('utm_campaign') || ''
    };
    try {
      root.sessionStorage.setItem(UTM_KEY, JSON.stringify(utm));
    } catch (e2) {
      /* noop */
    }
    return utm;
  }

  function referrerHost() {
    try {
      if (!root.document || !document.referrer) return '';
      return new URL(document.referrer).hostname || '';
    } catch (e) {
      return '';
    }
  }

  function groupKeyForTitle(title) {
    var versions = root.BurnfolderSongVersions;
    if (versions && typeof versions.getTrackGroupKey === 'function') {
      return versions.getTrackGroupKey(title) || 'unknown';
    }
    return String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ') || 'unknown';
  }

  function inferCut(song) {
    var path = (root.location && root.location.pathname) || '';
    if (path.indexOf('listen.html') !== -1) return 'share';
    var title = (song && song.title) || '';
    if (/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/.test(title) || /\b\d{4}-\d{2}-\d{2}\b/.test(title)) {
      return 'darkroom';
    }
    if (/^\d{1,2}\.\d{1,2}\.\d{2}\.html$/.test(path.split('/').pop() || '')) return 'journal';
    return 'release';
  }

  function enqueue(event) {
    if (!event || !shouldTrack()) return;
    event.ts = event.ts || new Date().toISOString();
    event.sessionId = sessionId();
    event.page = event.page || pagePath();
    // Heat rides in heatBuffer — never put giant pass lists on the droppable queue.
    if (event.heatPasses) delete event.heatPasses;
    if (event.heatCounts) delete event.heatCounts;
    queue.push(event);
    if (queue.length > MAX_QUEUE) {
      // Prefer dropping non-play noise; never drop play_start / play_end.
      var kept = [];
      var dropped = 0;
      for (var i = 0; i < queue.length; i++) {
        var ev = queue[i];
        var essential =
          ev.type === 'play_start' ||
          ev.type === 'play_end' ||
          ev.type === 'land' ||
          ev.type === 'pathway';
        if (essential || kept.length < MAX_QUEUE - 8) kept.push(ev);
        else dropped += 1;
      }
      queue = kept.slice(-MAX_QUEUE);
    }
    scheduleFlush();
  }

  function bufferHeat(meta, secondsList, duration, listenDelta) {
    if (!meta || !meta.groupKey || !secondsList || !secondsList.length) return;
    var key = meta.groupKey;
    if (!heatBuffer[key]) {
      heatBuffer[key] = {
        groupKey: meta.groupKey,
        title: meta.title || '',
        playbackId: meta.playbackId || '',
        cut: meta.cut || 'unknown',
        duration: 0,
        listenSeconds: 0,
        counts: {}
      };
    }
    var row = heatBuffer[key];
    if (meta.title) row.title = meta.title;
    if (meta.playbackId) row.playbackId = meta.playbackId;
    if (meta.cut) row.cut = meta.cut;
    row.duration = Math.max(row.duration, Number(duration) || 0);
    row.listenSeconds += Math.max(0, Number(listenDelta) || 0);
    for (var i = 0; i < secondsList.length; i++) {
      var s = Math.floor(Number(secondsList[i]) || 0);
      if (s < 0 || s >= MAX_HEAT_SECONDS) continue;
      row.counts[s] = (Number(row.counts[s]) || 0) + 1;
    }
    scheduleFlush();
  }

  function heatEventsFromBuffer() {
    var events = [];
    Object.keys(heatBuffer).forEach(function (key) {
      var row = heatBuffer[key];
      var counts = row.counts || {};
      var secs = Object.keys(counts)
        .map(function (k) {
          return Number(k);
        })
        .filter(function (n) {
          return counts[n] > 0;
        })
        .sort(function (a, b) {
          return a - b;
        });
      if (!secs.length && !(row.listenSeconds > 0)) return;
      // One compact event per song — survives queue pressure.
      events.push({
        type: 'play_progress',
        groupKey: row.groupKey,
        title: row.title,
        playbackId: row.playbackId,
        cut: row.cut,
        seconds: secs.length ? secs[secs.length - 1] + 1 : 0,
        prevSeconds: secs.length ? secs[0] : 0,
        duration: row.duration,
        heatCounts: counts,
        listenSeconds: row.listenSeconds,
        ts: new Date().toISOString(),
        sessionId: sessionId(),
        page: pagePath()
      });
    });
    return events;
  }

  function scheduleFlush() {
    if (flushTimer || ingestDisabled || !shouldTrack()) return;
    flushTimer = root.setTimeout(flush, FLUSH_MS);
  }

  function disableIngest() {
    ingestDisabled = true;
    if (flushTimer) {
      root.clearTimeout(flushTimer);
      flushTimer = null;
    }
    queue = [];
    heatBuffer = {};
  }

  function flush() {
    flushTimer = null;
    if (flushInFlight || ingestDisabled || !shouldTrack()) return;
    var heatEvents = heatEventsFromBuffer();
    var batch = heatEvents.concat(queue);
    if (!batch.length) return;
    queue = [];
    // Detach current heat buffer so in-flight listens keep accumulating safely.
    var shippedHeat = heatBuffer;
    heatBuffer = {};
    flushInFlight = true;
    var url = apiBase().replace(/\/$/, '') + '/site-analytics-ingest';
    var body = JSON.stringify({ events: batch });

    function mergeShippedBack() {
      Object.keys(shippedHeat).forEach(function (key) {
        var src = shippedHeat[key];
        if (!heatBuffer[key]) {
          heatBuffer[key] = src;
          return;
        }
        var dst = heatBuffer[key];
        dst.duration = Math.max(dst.duration, src.duration);
        dst.listenSeconds += src.listenSeconds || 0;
        Object.keys(src.counts || {}).forEach(function (sec) {
          dst.counts[sec] = (Number(dst.counts[sec]) || 0) + (Number(src.counts[sec]) || 0);
        });
      });
    }

    function fail() {
      flushInFlight = false;
      flushFailStreak += 1;
      mergeShippedBack();
      queue = batch
        .filter(function (ev) {
          return !ev.heatCounts;
        })
        .concat(queue)
        .slice(0, MAX_QUEUE);
      if (flushFailStreak >= MAX_FLUSH_FAILURES) {
        disableIngest();
        return;
      }
      scheduleFlush();
    }

    function ok() {
      flushInFlight = false;
      flushFailStreak = 0;
    }

    // Prefer fetch so dead ingest can trip the circuit breaker. sendBeacon often
    // returns true after only queueing, which masked :8888 connection failures.
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true,
      mode: 'cors'
    })
      .then(function (res) {
        if (!res || !res.ok) fail();
        else ok();
      })
      .catch(function () {
        fail();
      });
  }

  function finalizePathway(extraStep) {
    var steps = loadPath().slice();
    if (extraStep) {
      if (steps[steps.length - 1] !== extraStep) steps.push(extraStep);
    }
    if (steps.length < 2) return;
    steps = steps.slice(0, MAX_PATH_STEPS);
    var signature = steps.join(' → ');
    if (pathAlreadySent(signature)) return;
    markPathSent(signature);
    enqueue({
      type: 'pathway',
      steps: steps,
      finalized: true
    });
  }

  function recordStep(page) {
    if (!shouldTrack()) return;
    var full = page || pagePath();
    if (full === lastTrackedPage) return;
    lastTrackedPage = full;

    var label = shortLabel(full);
    var steps = loadPath();
    if (steps[steps.length - 1] === label) return;

    steps.push(label);
    if (steps.length > MAX_PATH_STEPS) {
      finalizePathway();
      steps = [label];
      try {
        root.sessionStorage.removeItem(PATH_SENT_KEY);
      } catch (e) {
        /* noop */
      }
    }
    savePath(steps);
  }

  function playerSeconds() {
    var player = root.document && document.getElementById('activeMuxPlayer');
    if (!player) return 0;
    var t = Number(player.currentTime);
    return Number.isFinite(t) && t > 0 ? t : 0;
  }

  function playerDuration() {
    var player = root.document && document.getElementById('activeMuxPlayer');
    if (!player) return 0;
    var d = Number(player.duration);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  function startPlay(song) {
    if (!song || !song.playbackId) return;
    var startAt = playerSeconds();
    var startFloor = Math.floor(startAt);
    active = {
      playbackId: String(song.playbackId),
      title: String(song.title || 'untitled'),
      groupKey: groupKeyForTitle(song.title),
      cut: inferCut(song),
      startSeconds: startAt,
      reportedSeconds: startAt,
      creditedThrough: startFloor - 1,
      creditedSecs: {},
      startedAt: Date.now()
    };
    enqueue({
      type: 'play_start',
      groupKey: active.groupKey,
      title: active.title,
      playbackId: active.playbackId,
      cut: active.cut,
      seconds: startAt,
      prevSeconds: startAt,
      startSeconds: startAt,
      duration: playerDuration()
    });
    creditRange(startFloor, startFloor, 0);
    startHeartbeat();
    bindPlayerTimeUpdate();
  }

  function activeMeta() {
    if (!active) return null;
    return {
      groupKey: active.groupKey,
      title: active.title,
      playbackId: active.playbackId,
      cut: active.cut
    };
  }

  function creditRange(fromInclusive, toInclusive, listenDelta) {
    if (!active) return;
    var from = Math.max(0, Math.floor(fromInclusive));
    var to = Math.max(from, Math.floor(toInclusive));
    if (!active.creditedSecs) active.creditedSecs = {};
    var passes = [];
    for (var s = from; s <= to && s < MAX_HEAT_SECONDS; s++) {
      // One pass per second per listen segment — prevents boundary spikes.
      if (active.creditedSecs[s]) continue;
      active.creditedSecs[s] = 1;
      passes.push(s);
    }
    if (!passes.length && !(listenDelta > 0)) return;
    bufferHeat(activeMeta(), passes, playerDuration(), listenDelta);
    if (passes.length) {
      active.creditedThrough = Math.max(active.creditedThrough, passes[passes.length - 1]);
    } else if (to >= from) {
      active.creditedThrough = Math.max(active.creditedThrough, to);
    }
  }

  function creditToPlayhead(forceEnd, fillToDuration) {
    if (!active) return;
    var t = playerSeconds();
    var duration = playerDuration();
    if (!forceEnd && t + SEEK_BACK_SEC < active.reportedSeconds) return;

    if (t < active.reportedSeconds && active.reportedSeconds - t < 0.5) {
      t = active.reportedSeconds;
    }

    var stopAt = forceEnd ? Math.max(t, active.reportedSeconds) : t;
    if (forceEnd && fillToDuration && duration > 0) {
      stopAt = Math.max(stopAt, duration);
    }

    var through = Math.max(0, Math.floor(stopAt - 1e-6));
    if (forceEnd && fillToDuration && duration > 0) {
      through = Math.max(through, Math.floor(duration - 1e-6));
    }

    var from = active.creditedThrough + 1;
    var listenDelta = Math.max(0, stopAt - active.reportedSeconds);
    if (through >= from) {
      // Credit the full contiguous range in one buffer write (no per-second events).
      creditRange(from, through, listenDelta);
    } else if (listenDelta > 0) {
      bufferHeat(activeMeta(), [], duration, listenDelta);
    }
    active.reportedSeconds = Math.max(active.reportedSeconds, stopAt);
  }

  function reportProgress(forceEnd, completed) {
    if (!active) return;
    var seconds = playerSeconds();
    var prev = active.reportedSeconds;

    if (!forceEnd && seconds + SEEK_BACK_SEC < prev) {
      reportProgress(true, false);
      var restartAt = seconds;
      active = {
        playbackId: active.playbackId,
        title: active.title,
        groupKey: active.groupKey,
        cut: active.cut,
        startSeconds: restartAt,
        reportedSeconds: restartAt,
        creditedThrough: Math.floor(restartAt) - 1,
        creditedSecs: {},
        startedAt: Date.now()
      };
      enqueue({
        type: 'play_start',
        groupKey: active.groupKey,
        title: active.title,
        playbackId: active.playbackId,
        cut: active.cut,
        seconds: restartAt,
        prevSeconds: restartAt,
        startSeconds: restartAt,
        duration: playerDuration()
      });
      creditToPlayhead(false, false);
      return;
    }

    if (forceEnd) {
      var duration = playerDuration();
      var fill = !!(completed || (duration > 0 && Math.max(seconds, prev) >= duration * 0.85));
      creditToPlayhead(true, fill);
      enqueue({
        type: 'play_end',
        groupKey: active.groupKey,
        title: active.title,
        playbackId: active.playbackId,
        cut: active.cut,
        seconds: active.reportedSeconds,
        prevSeconds: prev,
        startSeconds: active.startSeconds || 0,
        stopSeconds: active.reportedSeconds,
        duration: duration,
        completed: !!completed
      });
      return;
    }

    creditToPlayhead(false, false);
  }

  function endPlay(reason) {
    if (!active) return;
    var duration = playerDuration();
    var seconds = playerSeconds();
    if (seconds < active.reportedSeconds) seconds = active.reportedSeconds;
    var completed =
      reason === 'ended' ||
      (duration > 0 && seconds >= duration * 0.85);
    if (reason === 'ended' && duration > 0) {
      active.reportedSeconds = Math.max(active.reportedSeconds, duration);
      completed = true;
    }
    reportProgress(true, completed);
    active = null;
    stopHeartbeat();
    flush();
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = root.setInterval(function () {
      if (!active) return;
      creditToPlayhead(false, false);
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (!heartbeatTimer) return;
    root.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function bindPlayerTimeUpdate() {
    var player = root.document && document.getElementById('activeMuxPlayer');
    if (!player || player.dataset.bfAnalyticsTime === '1') return;
    player.dataset.bfAnalyticsTime = '1';
    player.addEventListener('timeupdate', function () {
      if (!active) return;
      creditToPlayhead(false, false);
    });
  }

  function onPlaybackChanged(event) {
    var detail = (event && event.detail) || {};
    var song = detail.song;
    if (!song || !song.playbackId) {
      endPlay('stop');
      return;
    }
    if (!detail.playing) {
      endPlay('pause');
      return;
    }
    if (!active || active.playbackId !== song.playbackId) {
      endPlay('switch');
      startPlay(song);
      return;
    }
    var t = playerSeconds();
    if (t + SEEK_BACK_SEC < active.reportedSeconds) {
      endPlay('seek-back');
      startPlay(song);
    }
  }

  function bindPlayerEnded() {
    var player = root.document && document.getElementById('activeMuxPlayer');
    if (!player || player.dataset.bfAnalyticsBound === '1') return;
    player.dataset.bfAnalyticsBound = '1';
    player.addEventListener('ended', function () {
      endPlay('ended');
    });
    bindPlayerTimeUpdate();
  }

  function classifyOutbound(href) {
    var h = String(href || '').toLowerCase();
    if (h.indexOf('open.spotify.com') !== -1 || h.indexOf('spotify.com') !== -1) return 'spotify';
    if (h.indexOf('music.apple.com') !== -1 || h.indexOf('itunes.apple.com') !== -1) return 'apple';
    if (h.indexOf('youtube.com') !== -1 || h.indexOf('youtu.be') !== -1) return 'youtube';
    if (h.indexOf('bandcamp.com') !== -1) return 'bandcamp';
    if (h.indexOf('soundcloud.com') !== -1) return 'soundcloud';
    return '';
  }

  function onClick(event) {
    var node = event.target;
    while (node && node.tagName !== 'A') node = node.parentElement;
    if (!node || !node.href) return;

    var dest = classifyOutbound(node.href);
    if (dest) {
      enqueue({
        type: 'outbound',
        dest: dest,
        href: String(node.href).slice(0, 240)
      });
      finalizePathway('out:' + dest);
      flush();
      return;
    }

    try {
      var url = new URL(node.href, root.location.href);
      if (url.origin === root.location.origin && url.pathname.indexOf('/studio/') !== 0) {
        // Soft-track likely next step; SPA event will confirm.
        var next =
          url.pathname +
          (url.search
            ? '?' +
              ['album', 'song', 't', 'entry']
                .map(function (key) {
                  return url.searchParams.has(key) ? key + '=' + url.searchParams.get(key) : '';
                })
                .filter(Boolean)
                .join('&')
            : '');
        // Don't record yet for full page loads — init/land handles it.
        if (root.history && typeof root.history.pushState === 'function') {
          /* spa may handle */
        }
        void next;
      }
    } catch (e) {
      /* noop */
    }
  }

  function sendLand() {
    try {
      if (root.sessionStorage.getItem(LAND_KEY) === '1') return;
      root.sessionStorage.setItem(LAND_KEY, '1');
    } catch (e) {
      /* still send once per load */
    }
    enqueue({
      type: 'land',
      referrerHost: referrerHost(),
      utm: readUtm()
    });
  }

  function onNavigated() {
    recordStep(pagePath());
    bindPlayerEnded();
  }

  function init() {
    if (started || !shouldTrack()) return;
    started = true;
    readUtm();
    sendLand();
    recordStep(pagePath());
    bindPlayerEnded();
    root.addEventListener('burnfolder-playback-changed', onPlaybackChanged);
    root.addEventListener('burnfolder-spa-navigated', onNavigated);
    root.document.addEventListener('click', onClick, true);
    root.addEventListener('pagehide', function () {
      endPlay('pagehide');
      finalizePathway();
      flush();
    });
    root.document.addEventListener('visibilitychange', function () {
      if (root.document.hidden) {
        reportProgress(false, false);
        flush();
      } else {
        bindPlayerEnded();
      }
    });
    root.addEventListener('popstate', onNavigated);
  }

  root.BurnfolderSiteAnalytics = {
    init: init,
    flush: flush,
    trackOutbound: function (dest, href) {
      enqueue({ type: 'outbound', dest: dest || 'other', href: href || '' });
      finalizePathway('out:' + (dest || 'other'));
      flush();
    }
  };

  if (root.document && root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
