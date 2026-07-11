/**
 * First-party site analytics (P16–P18).
 * Privacy-light: anonymous session id, no emails/fingerprints.
 * Skips studio paths. Batches to site-analytics-ingest.
 */
(function (root) {
  'use strict';

  var ENDPOINT = '/.netlify/functions/site-analytics-ingest';
  var SESSION_KEY = 'bf_analytics_sid';
  var LAND_KEY = 'bf_analytics_land';
  var UTM_KEY = 'bf_analytics_utm';
  var FLUSH_MS = 4000;
  var HEARTBEAT_MS = 15000;
  var MAX_QUEUE = 30;

  var queue = [];
  var flushTimer = null;
  var heartbeatTimer = null;
  var active = null;
  var started = false;

  function apiBase() {
    var host = root.location && root.location.hostname;
    var isLocalDevServer =
      (host === 'localhost' || host === '127.0.0.1') &&
      root.location.port &&
      root.location.port !== '8888';
    if (isLocalDevServer) return 'http://localhost:8888/.netlify/functions';
    return '/.netlify/functions';
  }

  function shouldTrack() {
    var host = (root.location && root.location.hostname) || '';
    var path = (root.location && root.location.pathname) || '';
    if (!/(^|\.)burnfolder\.com$/i.test(host) && host !== 'localhost' && host !== '127.0.0.1') {
      return false;
    }
    if (path.indexOf('/studio/') === 0) return false;
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
    queue.push(event);
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = root.setTimeout(flush, FLUSH_MS);
  }

  function flush() {
    flushTimer = null;
    if (!queue.length || !shouldTrack()) return;
    var batch = queue.slice();
    queue = [];
    var url = apiBase().replace(/\/$/, '') + '/site-analytics-ingest';
    var body = JSON.stringify({ events: batch });
    try {
      if (root.navigator && typeof root.navigator.sendBeacon === 'function') {
        var blob = new Blob([body], { type: 'application/json' });
        if (root.navigator.sendBeacon(url, blob)) return;
      }
    } catch (e) {
      /* fall through */
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true,
      mode: 'cors'
    }).catch(function () {
      queue = batch.concat(queue).slice(0, MAX_QUEUE);
    });
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
    active = {
      playbackId: String(song.playbackId),
      title: String(song.title || 'untitled'),
      groupKey: groupKeyForTitle(song.title),
      cut: inferCut(song),
      reportedSeconds: 0,
      startedAt: Date.now()
    };
    enqueue({
      type: 'play_start',
      groupKey: active.groupKey,
      title: active.title,
      playbackId: active.playbackId,
      cut: active.cut,
      seconds: 0,
      prevSeconds: 0
    });
    startHeartbeat();
  }

  function reportProgress(forceEnd, completed) {
    if (!active) return;
    var seconds = playerSeconds();
    if (seconds < active.reportedSeconds) seconds = active.reportedSeconds;
    var prev = active.reportedSeconds;
    if (!forceEnd && seconds - prev < 5) return;
    enqueue({
      type: forceEnd ? 'play_end' : 'play_progress',
      groupKey: active.groupKey,
      title: active.title,
      playbackId: active.playbackId,
      cut: active.cut,
      seconds: seconds,
      prevSeconds: prev,
      completed: !!completed
    });
    active.reportedSeconds = seconds;
  }

  function endPlay(reason) {
    if (!active) return;
    var duration = playerDuration();
    var seconds = playerSeconds();
    var completed =
      reason === 'ended' ||
      (duration > 0 && seconds >= duration * 0.9);
    reportProgress(true, completed);
    active = null;
    stopHeartbeat();
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = root.setInterval(function () {
      if (!active) return;
      reportProgress(false, false);
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (!heartbeatTimer) return;
    root.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function onPlaybackChanged(event) {
    var detail = (event && event.detail) || {};
    var song = detail.song;
    if (!song || !song.playbackId) {
      endPlay('stop');
      return;
    }
    if (!detail.playing) return;
    if (!active || active.playbackId !== song.playbackId) {
      endPlay('switch');
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
    if (!dest) return;
    enqueue({
      type: 'outbound',
      dest: dest,
      href: String(node.href).slice(0, 240)
    });
    flush();
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

  function init() {
    if (started || !shouldTrack()) return;
    started = true;
    readUtm();
    sendLand();
    bindPlayerEnded();
    root.addEventListener('burnfolder-playback-changed', onPlaybackChanged);
    root.document.addEventListener('click', onClick, true);
    root.addEventListener('pagehide', function () {
      endPlay('pagehide');
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
    // SPA navigations
    root.addEventListener('popstate', function () {
      bindPlayerEnded();
    });
  }

  root.BurnfolderSiteAnalytics = {
    init: init,
    flush: flush,
    trackOutbound: function (dest, href) {
      enqueue({ type: 'outbound', dest: dest || 'other', href: href || '' });
      flush();
    }
  };

  if (root.document && root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
