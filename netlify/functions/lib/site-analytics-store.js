'use strict';

const { getStore, connectLambda } = require('@netlify/blobs');

const STORE_NAME = 'site-analytics';
const AGG_KEY = 'aggregates/v1';
const COMMERCE_KEY = 'commerce/v1';
const MAX_RECENT_ORDERS = 80;
const MAX_PATH_KEYS = 80;
const MAX_SONG_KEYS = 200;
const MAX_OUTBOUND_KEYS = 40;
const MAX_UTM_KEYS = 60;
const MAX_PATHWAY_KEYS = 120;

const PERIODS = {
  hour: { label: 'hour', hours: 1 },
  day: { label: 'day', hours: 24 },
  week: { label: 'week', days: 7 },
  month: { label: 'month', days: 30 },
  year: { label: 'year', days: 365 },
  all: { label: 'all time' }
};

function analyticsStore(event) {
  if (event) connectLambda(event);
  return getStore(STORE_NAME);
}

function emptyAggregates() {
  return {
    version: 1,
    songs: {},
    paths: {},
    lands: { total: 0, withUtm: 0 },
    utm: {},
    referrers: {},
    outbound: {},
    pathways: {},
    updatedAt: null
  };
}

function emptyCommerce() {
  return {
    version: 1,
    tips: { count: 0, cents: 0 },
    digital: { count: 0, cents: 0 },
    shop: { count: 0, cents: 0 },
    recent: [],
    updatedAt: null
  };
}

function emptyBucket(id) {
  return {
    id: id,
    plays: 0,
    seconds: 0,
    lands: 0,
    landsWithUtm: 0,
    outbound: 0,
    completions: 0,
    songs: {},
    paths: {},
    utm: {},
    referrers: {},
    outboundByDest: {},
    pathways: {},
    commerce: {
      tips: { count: 0, cents: 0 },
      digital: { count: 0, cents: 0 },
      shop: { count: 0, cents: 0 }
    },
    updatedAt: null
  };
}

function emptyPeriodPatch() {
  return {
    plays: 0,
    seconds: 0,
    lands: 0,
    landsWithUtm: 0,
    outbound: 0,
    completions: 0,
    songs: {},
    paths: {},
    utm: {},
    referrers: {},
    outboundByDest: {},
    pathways: {}
  };
}

async function readAggregates(store) {
  const data = await store.get(AGG_KEY, { type: 'json' });
  if (!data || typeof data !== 'object') return emptyAggregates();
  return {
    version: 1,
    songs: data.songs && typeof data.songs === 'object' ? data.songs : {},
    paths: data.paths && typeof data.paths === 'object' ? data.paths : {},
    lands:
      data.lands && typeof data.lands === 'object'
        ? {
            total: Number(data.lands.total) || 0,
            withUtm: Number(data.lands.withUtm) || 0
          }
        : { total: 0, withUtm: 0 },
    utm: data.utm && typeof data.utm === 'object' ? data.utm : {},
    referrers: data.referrers && typeof data.referrers === 'object' ? data.referrers : {},
    outbound: data.outbound && typeof data.outbound === 'object' ? data.outbound : {},
    pathways: data.pathways && typeof data.pathways === 'object' ? data.pathways : {},
    updatedAt: data.updatedAt || null
  };
}

async function writeAggregates(store, agg) {
  agg.updatedAt = new Date().toISOString();
  await store.setJSON(AGG_KEY, agg);
}

async function readCommerce(store) {
  const data = await store.get(COMMERCE_KEY, { type: 'json' });
  if (!data || typeof data !== 'object') return emptyCommerce();
  return {
    version: 1,
    tips: {
      count: Number((data.tips && data.tips.count) || 0) || 0,
      cents: Number((data.tips && data.tips.cents) || 0) || 0
    },
    digital: {
      count: Number((data.digital && data.digital.count) || 0) || 0,
      cents: Number((data.digital && data.digital.cents) || 0) || 0
    },
    shop: {
      count: Number((data.shop && data.shop.count) || 0) || 0,
      cents: Number((data.shop && data.shop.cents) || 0) || 0
    },
    recent: Array.isArray(data.recent) ? data.recent.slice(0, MAX_RECENT_ORDERS) : [],
    updatedAt: data.updatedAt || null
  };
}

async function writeCommerce(store, commerce) {
  commerce.updatedAt = new Date().toISOString();
  await store.setJSON(COMMERCE_KEY, commerce);
}

function dayKey(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function hourKey(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 13);
  }
  return d.toISOString().slice(0, 13);
}

function trimMap(map, maxKeys, scoreFn) {
  const keys = Object.keys(map || {});
  if (keys.length <= maxKeys) return map;
  keys
    .sort(function (a, b) {
      return (scoreFn(map[b], b) || 0) - (scoreFn(map[a], a) || 0);
    })
    .slice(maxKeys)
    .forEach(function (k) {
      delete map[k];
    });
  return map;
}

var MAX_HEAT_SECONDS = 20 * 60; // 20 min cap per song

function emptyHeat(len) {
  const n = Math.max(0, Math.min(MAX_HEAT_SECONDS, Math.ceil(Number(len) || 0)));
  const heat = [];
  for (let i = 0; i < n; i++) heat.push(0);
  return heat;
}

function ensureHeatLength(song, seconds) {
  const need = Math.max(1, Math.min(MAX_HEAT_SECONDS, Math.ceil(Number(seconds) || 0)));
  if (!Array.isArray(song.heat)) song.heat = emptyHeat(need);
  while (song.heat.length < need) song.heat.push(0);
  if (song.heat.length > MAX_HEAT_SECONDS) song.heat.length = MAX_HEAT_SECONDS;
  return song.heat;
}

function isLegacyHeatBins(heat, heatUnit) {
  if (heatUnit === 's') return false;
  return Array.isArray(heat) && heat.length === 32;
}

function expandLegacyHeatBins(raw, durationSeconds) {
  const len = Math.max(1, Math.min(MAX_HEAT_SECONDS, Math.ceil(Number(durationSeconds) || 32)));
  const out = emptyHeat(len);
  for (let i = 0; i < 32; i++) {
    const v = Number(raw[i]) || 0;
    if (v <= 0) continue;
    const a = Math.floor((i / 32) * len);
    const b = Math.max(a + 1, Math.floor(((i + 1) / 32) * len));
    const share = v / (b - a);
    for (let s = a; s < b && s < len; s++) out[s] += share;
  }
  return out;
}

function normalizeHeat(raw, durationSeconds, heatUnit) {
  if (!Array.isArray(raw) || !raw.length) {
    return emptyHeat(Math.max(1, Math.ceil(Number(durationSeconds) || 0)));
  }
  if (isLegacyHeatBins(raw, heatUnit)) {
    return expandLegacyHeatBins(raw, durationSeconds || raw.length);
  }
  const len = Math.min(
    MAX_HEAT_SECONDS,
    Math.max(raw.length, Math.ceil(Number(durationSeconds) || 0))
  );
  const heat = emptyHeat(len);
  for (let i = 0; i < Math.min(len, raw.length); i++) {
    heat[i] = Number(raw[i]) || 0;
  }
  return heat;
}

function mergeHeatInto(targetSong, sourceHeat, sourceDuration, sourceUnit) {
  const unit = sourceUnit || (sourceHeat && sourceHeat.length === 32 ? '' : 's');
  const src = normalizeHeat(
    sourceHeat,
    sourceDuration || (sourceHeat && sourceHeat.length) || 0,
    unit
  );
  const heat = ensureHeatLength(
    targetSong,
    Math.max(src.length, Number(targetSong.durationSeconds) || 0)
  );
  for (let i = 0; i < src.length; i++) {
    heat[i] = (Number(heat[i]) || 0) + (Number(src[i]) || 0);
  }
  if (unit === 's') targetSong.heatUnit = 's';
}

function addHeatCounts(song, patchSong, counts, durationSec) {
  if (!counts || typeof counts !== 'object') return;
  const passes = [];
  Object.keys(counts).forEach(function (key) {
    const sec = Math.floor(Number(key) || 0);
    const n = Math.max(0, Math.min(Math.floor(Number(counts[key]) || 0), 1000));
    for (let i = 0; i < n; i++) passes.push(sec);
  });
  addHeatPasses(song, patchSong, passes, durationSec);
}

function addHeatPasses(song, patchSong, passes, durationSec) {
  if (!Array.isArray(passes) || !passes.length) return;
  let maxIndex = 0;
  for (let i = 0; i < passes.length; i++) {
    const s = Math.floor(Number(passes[i]) || 0);
    if (s > maxIndex) maxIndex = s;
  }
  const duration = Math.max(
    Number(durationSec) || 0,
    maxIndex + 1,
    Number(song.durationSeconds) || 0,
    1
  );

  // Drop legacy 32-bin heat once real per-second passes arrive — otherwise the
  // chart stays stuck as 32 coarse bars with a quiet tail.
  if (
    song.heatUnit !== 's' ||
    (Array.isArray(song.heat) && song.heat.length === 32 && Number(song.durationSeconds) > 40)
  ) {
    if (isLegacyHeatBins(song.heat, song.heatUnit) || song.heatUnit === 'bin32') {
      song.heat = [];
    } else if (Array.isArray(song.heat) && song.heat.length === 32 && duration > 40) {
      song.heat = [];
    }
  }

  song.durationSeconds = Math.max(Number(song.durationSeconds) || 0, duration);
  song.heatUnit = 's';
  if (patchSong) {
    if (
      patchSong.heatUnit !== 's' ||
      (Array.isArray(patchSong.heat) && patchSong.heat.length === 32 && duration > 40)
    ) {
      patchSong.heat = [];
    }
    patchSong.durationSeconds = Math.max(Number(patchSong.durationSeconds) || 0, duration);
    patchSong.heatUnit = 's';
  }
  const maxSec = Math.min(MAX_HEAT_SECONDS, Math.ceil(duration));
  const songHeat = ensureHeatLength(song, maxSec);
  const patchHeat = patchSong ? ensureHeatLength(patchSong, maxSec) : null;
  for (let i = 0; i < passes.length; i++) {
    const s = Math.floor(Number(passes[i]) || 0);
    if (s < 0 || s >= maxSec) continue;
    songHeat[s] = (Number(songHeat[s]) || 0) + 1;
    if (patchHeat) patchHeat[s] = (Number(patchHeat[s]) || 0) + 1;
  }
}

function addHeatSpan(song, patchSong, fromSec, toSec, durationSec) {
  const start = Math.max(0, Number(fromSec) || 0);
  const end = Math.max(start, Number(toSec) || 0);
  if (end <= start) return;
  const from = Math.floor(start);
  const to = Math.min(MAX_HEAT_SECONDS - 1, Math.max(from, Math.floor(end - 1e-6)));
  const passes = [];
  for (let s = from; s <= to; s++) passes.push(s);
  addHeatPasses(song, patchSong, passes, durationSec || end);
}

function ensureSong(map, groupKey, title) {
  const key = String(groupKey || 'unknown').slice(0, 80) || 'unknown';
  if (!map[key]) {
    map[key] = {
      groupKey: key,
      title: String(title || key).slice(0, 120),
      plays: 0,
      seconds: 0,
      completions: 0,
      byCut: {},
      lastPlayedAt: null,
      startSum: 0,
      stopSum: 0,
      spanSamples: 0,
      lastStartSeconds: null,
      lastStopSeconds: null,
      durationSeconds: 0,
      heatUnit: '',
      heat: []
    };
  }
  if (title && (!map[key].title || map[key].title === key)) {
    map[key].title = String(title).slice(0, 120);
  }
  if (Array.isArray(map[key].heat) && map[key].heat.length) {
    const wasLegacy = isLegacyHeatBins(map[key].heat, map[key].heatUnit);
    map[key].heat = normalizeHeat(map[key].heat, map[key].durationSeconds, map[key].heatUnit);
    if (wasLegacy) map[key].heatUnit = 'bin32';
  }
  return map[key];
}

function mergeSongInto(targetMap, song) {
  const row = ensureSong(targetMap, song.groupKey, song.title);
  row.plays += Number(song.plays) || 0;
  row.seconds += Number(song.seconds) || 0;
  row.completions += Number(song.completions) || 0;
  row.startSum = (Number(row.startSum) || 0) + (Number(song.startSum) || 0);
  row.stopSum = (Number(row.stopSum) || 0) + (Number(song.stopSum) || 0);
  row.spanSamples = (Number(row.spanSamples) || 0) + (Number(song.spanSamples) || 0);
  row.durationSeconds = Math.max(Number(row.durationSeconds) || 0, Number(song.durationSeconds) || 0);
  mergeHeatInto(row, song.heat, song.durationSeconds, song.heatUnit);
  if (song.lastPlayedAt) row.lastPlayedAt = song.lastPlayedAt;
  if (song.lastStartSeconds != null) row.lastStartSeconds = Number(song.lastStartSeconds);
  if (song.lastStopSeconds != null) row.lastStopSeconds = Number(song.lastStopSeconds);
  const byCut = song.byCut || {};
  Object.keys(byCut).forEach(function (cut) {
    if (!row.byCut[cut]) row.byCut[cut] = { plays: 0, seconds: 0, completions: 0 };
    row.byCut[cut].plays += Number(byCut[cut].plays) || 0;
    row.byCut[cut].seconds += Number(byCut[cut].seconds) || 0;
    row.byCut[cut].completions += Number(byCut[cut].completions) || 0;
  });
}

function recordListenSpan(song, patchSong, startSeconds, stopSeconds) {
  const start = Math.max(0, Math.min(Number(startSeconds) || 0, 60 * 60));
  const stop = Math.max(start, Math.min(Number(stopSeconds) || 0, 60 * 60));
  song.startSum = (Number(song.startSum) || 0) + start;
  song.stopSum = (Number(song.stopSum) || 0) + stop;
  song.spanSamples = (Number(song.spanSamples) || 0) + 1;
  song.lastStartSeconds = start;
  song.lastStopSeconds = stop;
  patchSong.startSum = (Number(patchSong.startSum) || 0) + start;
  patchSong.stopSum = (Number(patchSong.stopSum) || 0) + stop;
  patchSong.spanSamples = (Number(patchSong.spanSamples) || 0) + 1;
  patchSong.lastStartSeconds = start;
  patchSong.lastStopSeconds = stop;
}

function mergePathInto(targetMap, page, lands, plays) {
  if (!page) return;
  if (!targetMap[page]) targetMap[page] = { page: page, lands: 0, plays: 0 };
  targetMap[page].lands += Number(lands) || 0;
  targetMap[page].plays += Number(plays) || 0;
}

function mergeCountedInto(targetMap, key, field, amount, seed) {
  if (!key) return;
  if (!targetMap[key]) targetMap[key] = seed;
  targetMap[key][field] = (Number(targetMap[key][field]) || 0) + (Number(amount) || 0);
}

function bumpPathway(map, steps, ts) {
  const clean = (Array.isArray(steps) ? steps : [])
    .map(function (s) {
      return String(s || '')
        .trim()
        .slice(0, 48);
    })
    .filter(Boolean)
    .slice(0, 8);
  if (clean.length < 2) return;
  const key = clean.join(' → ').slice(0, 280);
  if (!map[key]) {
    map[key] = { path: key, steps: clean, count: 0, lastSeenAt: null };
  }
  map[key].count += 1;
  map[key].lastSeenAt = ts || new Date().toISOString();
  map[key].steps = clean;
}

function applyEvent(agg, event, patch) {
  const type = String((event && event.type) || '');
  const page = String((event && event.page) || '').slice(0, 160);
  const now = (event && event.ts) || new Date().toISOString();

  if (type === 'pathway') {
    bumpPathway(agg.pathways, event.steps, now);
    bumpPathway(patch.pathways, event.steps, now);
    return;
  }

  if (type === 'land') {
    agg.lands.total += 1;
    patch.lands += 1;
    if (page) {
      if (!agg.paths[page]) agg.paths[page] = { page: page, lands: 0, plays: 0 };
      agg.paths[page].lands += 1;
      mergePathInto(patch.paths, page, 1, 0);
    }
    const utm = event.utm && typeof event.utm === 'object' ? event.utm : {};
    const hasUtm = !!(utm.source || utm.medium || utm.campaign);
    if (hasUtm) {
      agg.lands.withUtm += 1;
      patch.landsWithUtm += 1;
      const utmKey = [utm.source || '-', utm.medium || '-', utm.campaign || '-'].join('|').slice(0, 120);
      if (!agg.utm[utmKey]) {
        agg.utm[utmKey] = {
          source: String(utm.source || '').slice(0, 64),
          medium: String(utm.medium || '').slice(0, 64),
          campaign: String(utm.campaign || '').slice(0, 64),
          lands: 0
        };
      }
      agg.utm[utmKey].lands += 1;
      mergeCountedInto(
        patch.utm,
        utmKey,
        'lands',
        1,
        {
          source: String(utm.source || '').slice(0, 64),
          medium: String(utm.medium || '').slice(0, 64),
          campaign: String(utm.campaign || '').slice(0, 64),
          lands: 0
        }
      );
    }
    const ref = String((event && event.referrerHost) || '').slice(0, 80);
    if (ref) {
      if (!agg.referrers[ref]) agg.referrers[ref] = { host: ref, lands: 0 };
      agg.referrers[ref].lands += 1;
      mergeCountedInto(patch.referrers, ref, 'lands', 1, { host: ref, lands: 0 });
    }
    return;
  }

  if (type === 'play_start' || type === 'play_progress' || type === 'play_end') {
    const song = ensureSong(agg.songs, event.groupKey, event.title);
    const cut = String(event.cut || 'unknown').slice(0, 32);
    if (!song.byCut[cut]) song.byCut[cut] = { plays: 0, seconds: 0, completions: 0 };
    const patchSong = ensureSong(patch.songs, event.groupKey, event.title);
    if (!patchSong.byCut[cut]) patchSong.byCut[cut] = { plays: 0, seconds: 0, completions: 0 };

    if (type === 'play_start') {
      song.plays += 1;
      song.byCut[cut].plays += 1;
      song.lastPlayedAt = now;
      patch.plays += 1;
      patchSong.plays += 1;
      patchSong.byCut[cut].plays += 1;
      patchSong.lastPlayedAt = now;
      if (page) {
        if (!agg.paths[page]) agg.paths[page] = { page: page, lands: 0, plays: 0 };
        agg.paths[page].plays += 1;
        mergePathInto(patch.paths, page, 0, 1);
      }
    }

    const seconds = Math.max(0, Math.min(Number(event.seconds) || 0, 60 * 60));
    const prevSeconds = Math.max(0, Math.min(Number(event.prevSeconds) || 0, 60 * 60));
    const duration = Math.max(0, Math.min(Number(event.duration) || 0, 60 * 60));
    const delta = Math.max(
      0,
      Number(event.listenSeconds) || 0,
      seconds - prevSeconds
    );
    const maxDelta = type === 'play_end' ? 30 * 60 : 30 * 60;
    const heatCounts = event.heatCounts && typeof event.heatCounts === 'object' ? event.heatCounts : null;
    const heatPasses = Array.isArray(event.heatPasses) ? event.heatPasses : null;

    if (delta > 0 && delta <= maxDelta) {
      song.seconds += delta;
      song.byCut[cut].seconds += delta;
      patch.seconds += delta;
      patchSong.seconds += delta;
      patchSong.byCut[cut].seconds += delta;
    } else if (duration > 0) {
      song.durationSeconds = Math.max(Number(song.durationSeconds) || 0, duration);
      patchSong.durationSeconds = Math.max(Number(patchSong.durationSeconds) || 0, duration);
    }

    if (heatCounts) {
      addHeatCounts(song, patchSong, heatCounts, duration || seconds);
    } else if (heatPasses && heatPasses.length) {
      addHeatPasses(song, patchSong, heatPasses, duration || seconds);
    } else if (delta > 0 && delta <= maxDelta && type !== 'play_start') {
      addHeatSpan(song, patchSong, prevSeconds, seconds, duration || seconds);
    }

    if (type === 'play_end' && event.completed) {
      song.completions += 1;
      song.byCut[cut].completions += 1;
      patch.completions += 1;
      patchSong.completions += 1;
      patchSong.byCut[cut].completions += 1;
    }

    if (type === 'play_end') {
      const startSeconds =
        event.startSeconds != null ? event.startSeconds : prevSeconds;
      const stopSeconds = event.stopSeconds != null ? event.stopSeconds : seconds;
      recordListenSpan(song, patchSong, startSeconds, stopSeconds);
    }
    return;
  }

  if (type === 'outbound') {
    const dest = String(event.dest || 'other').slice(0, 32);
    if (!agg.outbound[dest]) agg.outbound[dest] = { dest: dest, clicks: 0 };
    agg.outbound[dest].clicks += 1;
    patch.outbound += 1;
    mergeCountedInto(patch.outboundByDest, dest, 'clicks', 1, { dest: dest, clicks: 0 });
  }
}

async function readBucket(store, key) {
  const data = await store.get(key, { type: 'json' });
  if (!data || typeof data !== 'object') return emptyBucket(key);
  const bucket = emptyBucket(key);
  bucket.plays = Number(data.plays) || 0;
  bucket.seconds = Number(data.seconds) || 0;
  bucket.lands = Number(data.lands) || 0;
  bucket.landsWithUtm = Number(data.landsWithUtm) || 0;
  bucket.outbound = Number(data.outbound) || 0;
  bucket.completions = Number(data.completions) || 0;
  bucket.songs = data.songs && typeof data.songs === 'object' ? data.songs : {};
  bucket.paths = data.paths && typeof data.paths === 'object' ? data.paths : {};
  bucket.utm = data.utm && typeof data.utm === 'object' ? data.utm : {};
  bucket.referrers = data.referrers && typeof data.referrers === 'object' ? data.referrers : {};
  bucket.outboundByDest =
    data.outboundByDest && typeof data.outboundByDest === 'object' ? data.outboundByDest : {};
  bucket.pathways = data.pathways && typeof data.pathways === 'object' ? data.pathways : {};
  if (data.commerce && typeof data.commerce === 'object') {
    ['tips', 'digital', 'shop'].forEach(function (kind) {
      bucket.commerce[kind].count = Number((data.commerce[kind] && data.commerce[kind].count) || 0) || 0;
      bucket.commerce[kind].cents = Number((data.commerce[kind] && data.commerce[kind].cents) || 0) || 0;
    });
  }
  bucket.updatedAt = data.updatedAt || null;
  return bucket;
}

async function writeBucket(store, key, bucket) {
  trimMap(bucket.songs, MAX_SONG_KEYS, function (row) {
    return (row.plays || 0) * 10 + (row.seconds || 0);
  });
  trimMap(bucket.paths, MAX_PATH_KEYS, function (row) {
    return (row.lands || 0) + (row.plays || 0);
  });
  trimMap(bucket.outboundByDest, MAX_OUTBOUND_KEYS, function (row) {
    return row.clicks || 0;
  });
  trimMap(bucket.utm, MAX_UTM_KEYS, function (row) {
    return row.lands || 0;
  });
  trimMap(bucket.referrers, MAX_UTM_KEYS, function (row) {
    return row.lands || 0;
  });
  trimMap(bucket.pathways, MAX_PATHWAY_KEYS, function (row) {
    return row.count || 0;
  });
  bucket.updatedAt = new Date().toISOString();
  await store.setJSON(key, bucket);
}

function mergePatchIntoBucket(bucket, patch) {
  bucket.plays += Number(patch.plays) || 0;
  bucket.seconds += Number(patch.seconds) || 0;
  bucket.lands += Number(patch.lands) || 0;
  bucket.landsWithUtm += Number(patch.landsWithUtm) || 0;
  bucket.outbound += Number(patch.outbound) || 0;
  bucket.completions += Number(patch.completions) || 0;

  Object.keys(patch.songs || {}).forEach(function (k) {
    mergeSongInto(bucket.songs, patch.songs[k]);
  });
  Object.keys(patch.paths || {}).forEach(function (k) {
    const row = patch.paths[k];
    mergePathInto(bucket.paths, row.page || k, row.lands, row.plays);
  });
  Object.keys(patch.utm || {}).forEach(function (k) {
    const row = patch.utm[k];
    mergeCountedInto(bucket.utm, k, 'lands', row.lands, {
      source: row.source || '',
      medium: row.medium || '',
      campaign: row.campaign || '',
      lands: 0
    });
  });
  Object.keys(patch.referrers || {}).forEach(function (k) {
    const row = patch.referrers[k];
    mergeCountedInto(bucket.referrers, k, 'lands', row.lands, { host: row.host || k, lands: 0 });
  });
  Object.keys(patch.outboundByDest || {}).forEach(function (k) {
    const row = patch.outboundByDest[k];
    mergeCountedInto(bucket.outboundByDest, k, 'clicks', row.clicks, { dest: row.dest || k, clicks: 0 });
  });
  Object.keys(patch.pathways || {}).forEach(function (k) {
    const row = patch.pathways[k];
    if (!bucket.pathways[k]) {
      bucket.pathways[k] = {
        path: row.path || k,
        steps: Array.isArray(row.steps) ? row.steps.slice() : [],
        count: 0,
        lastSeenAt: null
      };
    }
    bucket.pathways[k].count += Number(row.count) || 0;
    if (row.lastSeenAt) bucket.pathways[k].lastSeenAt = row.lastSeenAt;
    if (row.steps && row.steps.length) bucket.pathways[k].steps = row.steps.slice();
  });
}

async function bumpBuckets(store, iso, patch) {
  const day = 'days/' + dayKey(iso);
  const hour = 'hours/' + hourKey(iso);
  const dayBucket = await readBucket(store, day);
  const hourBucket = await readBucket(store, hour);
  mergePatchIntoBucket(dayBucket, patch);
  mergePatchIntoBucket(hourBucket, patch);
  await writeBucket(store, day, dayBucket);
  await writeBucket(store, hour, hourBucket);
}

async function ingestEvents(store, events) {
  const agg = await readAggregates(store);
  const patchesByStamp = {};

  (events || []).forEach(function (event) {
    if (!event || typeof event !== 'object') return;
    const stamp = event.ts || new Date().toISOString();
    const key = dayKey(stamp) + '|' + hourKey(stamp);
    if (!patchesByStamp[key]) {
      patchesByStamp[key] = { iso: stamp, patch: emptyPeriodPatch() };
    }
    applyEvent(agg, event, patchesByStamp[key].patch);
  });

  trimMap(agg.songs, MAX_SONG_KEYS, function (row) {
    return (row.plays || 0) * 10 + (row.seconds || 0);
  });
  trimMap(agg.paths, MAX_PATH_KEYS, function (row) {
    return (row.lands || 0) + (row.plays || 0);
  });
  trimMap(agg.outbound, MAX_OUTBOUND_KEYS, function (row) {
    return row.clicks || 0;
  });
  trimMap(agg.utm, MAX_UTM_KEYS, function (row) {
    return row.lands || 0;
  });
  trimMap(agg.referrers, MAX_UTM_KEYS, function (row) {
    return row.lands || 0;
  });
  trimMap(agg.pathways, MAX_PATHWAY_KEYS, function (row) {
    return row.count || 0;
  });

  await writeAggregates(store, agg);

  const keys = Object.keys(patchesByStamp);
  for (let i = 0; i < keys.length; i++) {
    const entry = patchesByStamp[keys[i]];
    await bumpBuckets(store, entry.iso, entry.patch);
  }

  return agg;
}

async function recordCommerceOrder(store, order) {
  const commerce = await readCommerce(store);
  const kind = order.kind === 'tip' || order.kind === 'digital' || order.kind === 'shop' ? order.kind : 'shop';
  const cents = Math.max(0, Math.round(Number(order.cents) || 0));
  const at = order.at || new Date().toISOString();
  commerce[kind].count += 1;
  commerce[kind].cents += cents;
  commerce.recent.unshift({
    kind: kind,
    cents: cents,
    productTitle: String(order.productTitle || '').slice(0, 120),
    at: at,
    id: String(order.id || '').slice(0, 80)
  });
  commerce.recent = commerce.recent.slice(0, MAX_RECENT_ORDERS);
  await writeCommerce(store, commerce);

  const day = await readBucket(store, 'days/' + dayKey(at));
  const hour = await readBucket(store, 'hours/' + hourKey(at));
  day.commerce[kind].count += 1;
  day.commerce[kind].cents += cents;
  hour.commerce[kind].count += 1;
  hour.commerce[kind].cents += cents;
  await writeBucket(store, 'days/' + dayKey(at), day);
  await writeBucket(store, 'hours/' + hourKey(at), hour);

  return commerce;
}

function normalizePeriod(raw) {
  const key = String(raw || 'week').toLowerCase();
  return PERIODS[key] ? key : 'week';
}

function periodWindow(periodKey) {
  const period = PERIODS[periodKey] || PERIODS.week;
  if (periodKey === 'all') {
    return { period: periodKey, since: null, until: new Date().toISOString(), mode: 'all' };
  }
  const until = new Date();
  const since = new Date(until.getTime());
  if (period.hours) since.setTime(until.getTime() - period.hours * 3600000);
  else since.setTime(until.getTime() - (period.days || 7) * 86400000);
  return {
    period: periodKey,
    since: since.toISOString(),
    until: until.toISOString(),
    mode: period.hours ? 'hours' : 'days'
  };
}

function mergeBuckets(buckets) {
  const out = emptyBucket('period');
  (buckets || []).forEach(function (bucket) {
    if (!bucket) return;
    out.plays += Number(bucket.plays) || 0;
    out.seconds += Number(bucket.seconds) || 0;
    out.lands += Number(bucket.lands) || 0;
    out.landsWithUtm += Number(bucket.landsWithUtm) || 0;
    out.outbound += Number(bucket.outbound) || 0;
    out.completions += Number(bucket.completions) || 0;
    Object.keys(bucket.songs || {}).forEach(function (k) {
      mergeSongInto(out.songs, bucket.songs[k]);
    });
    Object.keys(bucket.paths || {}).forEach(function (k) {
      const row = bucket.paths[k];
      mergePathInto(out.paths, row.page || k, row.lands, row.plays);
    });
    Object.keys(bucket.utm || {}).forEach(function (k) {
      const row = bucket.utm[k];
      mergeCountedInto(out.utm, k, 'lands', row.lands, {
        source: row.source || '',
        medium: row.medium || '',
        campaign: row.campaign || '',
        lands: 0
      });
    });
    Object.keys(bucket.referrers || {}).forEach(function (k) {
      const row = bucket.referrers[k];
      mergeCountedInto(out.referrers, k, 'lands', row.lands, { host: row.host || k, lands: 0 });
    });
    Object.keys(bucket.outboundByDest || {}).forEach(function (k) {
      const row = bucket.outboundByDest[k];
      mergeCountedInto(out.outboundByDest, k, 'clicks', row.clicks, { dest: row.dest || k, clicks: 0 });
    });
    Object.keys(bucket.pathways || {}).forEach(function (k) {
      const row = bucket.pathways[k];
      if (!out.pathways[k]) {
        out.pathways[k] = {
          path: row.path || k,
          steps: Array.isArray(row.steps) ? row.steps.slice() : [],
          count: 0,
          lastSeenAt: null
        };
      }
      out.pathways[k].count += Number(row.count) || 0;
      if (row.lastSeenAt) out.pathways[k].lastSeenAt = row.lastSeenAt;
      if (row.steps && row.steps.length) out.pathways[k].steps = row.steps.slice();
    });
    ['tips', 'digital', 'shop'].forEach(function (kind) {
      out.commerce[kind].count += Number((bucket.commerce && bucket.commerce[kind] && bucket.commerce[kind].count) || 0);
      out.commerce[kind].cents += Number((bucket.commerce && bucket.commerce[kind] && bucket.commerce[kind].cents) || 0);
    });
  });
  return out;
}

async function readPeriodBuckets(store, periodKey) {
  const window = periodWindow(periodKey);
  if (window.mode === 'all') {
    const agg = await readAggregates(store);
    const commerce = await readCommerce(store);
    return {
      window: window,
      bucket: {
        plays: Object.keys(agg.songs).reduce(function (n, k) {
          return n + (agg.songs[k].plays || 0);
        }, 0),
        seconds: Object.keys(agg.songs).reduce(function (n, k) {
          return n + (agg.songs[k].seconds || 0);
        }, 0),
        lands: (agg.lands && agg.lands.total) || 0,
        landsWithUtm: (agg.lands && agg.lands.withUtm) || 0,
        outbound: Object.keys(agg.outbound).reduce(function (n, k) {
          return n + (agg.outbound[k].clicks || 0);
        }, 0),
        completions: Object.keys(agg.songs).reduce(function (n, k) {
          return n + (agg.songs[k].completions || 0);
        }, 0),
        songs: agg.songs,
        paths: agg.paths,
        utm: agg.utm,
        referrers: agg.referrers,
        outboundByDest: agg.outbound,
        pathways: agg.pathways,
        commerce: {
          tips: commerce.tips,
          digital: commerce.digital,
          shop: commerce.shop
        },
        updatedAt: agg.updatedAt
      },
      commerceRecent: commerce.recent,
      series: []
    };
  }

  const since = new Date(window.since);
  const until = new Date(window.until);
  const keys = [];
  if (window.mode === 'hours') {
    for (let t = since.getTime(); t <= until.getTime(); t += 3600000) {
      keys.push('hours/' + new Date(t).toISOString().slice(0, 13));
    }
  } else {
    for (let t = since.getTime(); t <= until.getTime(); t += 86400000) {
      keys.push('days/' + new Date(t).toISOString().slice(0, 10));
    }
  }

  const buckets = [];
  for (let i = 0; i < keys.length; i++) {
    buckets.push(await readBucket(store, keys[i]));
  }

  const commerce = await readCommerce(store);
  const sinceMs = since.getTime();
  const recent = (commerce.recent || []).filter(function (row) {
    const at = row && row.at ? new Date(row.at).getTime() : 0;
    return at >= sinceMs;
  });

  return {
    window: window,
    bucket: mergeBuckets(buckets),
    commerceRecent: recent,
    series: buckets.map(function (b) {
      return {
        id: b.id,
        plays: b.plays,
        seconds: b.seconds,
        lands: b.lands,
        outbound: b.outbound,
        completions: b.completions
      };
    })
  };
}

async function readRecentDays(store, days) {
  const n = Math.max(1, Math.min(Number(days) || 14, 90));
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push(await readBucket(store, 'days/' + d.toISOString().slice(0, 10)));
  }
  return out;
}

module.exports = {
  analyticsStore,
  emptyAggregates,
  emptyCommerce,
  readAggregates,
  writeAggregates,
  readCommerce,
  writeCommerce,
  ingestEvents,
  recordCommerceOrder,
  readRecentDays,
  readPeriodBuckets,
  normalizePeriod,
  periodWindow,
  PERIODS,
  AGG_KEY,
  COMMERCE_KEY
};
