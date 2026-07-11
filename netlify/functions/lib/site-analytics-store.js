'use strict';

const { getStore, connectLambda } = require('@netlify/blobs');

const STORE_NAME = 'site-analytics';
const AGG_KEY = 'aggregates/v1';
const COMMERCE_KEY = 'commerce/v1';
const MAX_RECENT_ORDERS = 40;
const MAX_PATH_KEYS = 80;
const MAX_SONG_KEYS = 200;
const MAX_OUTBOUND_KEYS = 40;
const MAX_UTM_KEYS = 60;

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

async function bumpDay(store, iso, patch) {
  const key = 'days/' + dayKey(iso);
  let day = await store.get(key, { type: 'json' });
  if (!day || typeof day !== 'object') {
    day = { date: dayKey(iso), plays: 0, seconds: 0, lands: 0, outbound: 0, completions: 0 };
  }
  Object.keys(patch || {}).forEach(function (k) {
    day[k] = (Number(day[k]) || 0) + (Number(patch[k]) || 0);
  });
  day.updatedAt = new Date().toISOString();
  await store.setJSON(key, day);
  return day;
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

function ensureSong(agg, groupKey, title) {
  const key = String(groupKey || 'unknown').slice(0, 80) || 'unknown';
  if (!agg.songs[key]) {
    agg.songs[key] = {
      groupKey: key,
      title: String(title || key).slice(0, 120),
      plays: 0,
      seconds: 0,
      completions: 0,
      byCut: {},
      lastPlayedAt: null
    };
  }
  if (title && (!agg.songs[key].title || agg.songs[key].title === key)) {
    agg.songs[key].title = String(title).slice(0, 120);
  }
  return agg.songs[key];
}

function applyEvent(agg, event, dayPatch) {
  const type = String((event && event.type) || '');
  const page = String((event && event.page) || '').slice(0, 160);
  const now = (event && event.ts) || new Date().toISOString();

  if (type === 'land') {
    agg.lands.total += 1;
    dayPatch.lands = (dayPatch.lands || 0) + 1;
    if (page) {
      if (!agg.paths[page]) agg.paths[page] = { page: page, lands: 0, plays: 0 };
      agg.paths[page].lands += 1;
    }
    const utm = event.utm && typeof event.utm === 'object' ? event.utm : {};
    const hasUtm = !!(utm.source || utm.medium || utm.campaign);
    if (hasUtm) {
      agg.lands.withUtm += 1;
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
    }
    const ref = String((event && event.referrerHost) || '').slice(0, 80);
    if (ref) {
      if (!agg.referrers[ref]) agg.referrers[ref] = { host: ref, lands: 0 };
      agg.referrers[ref].lands += 1;
    }
    return;
  }

  if (type === 'play_start' || type === 'play_progress' || type === 'play_end') {
    const song = ensureSong(agg, event.groupKey, event.title);
    const cut = String(event.cut || 'unknown').slice(0, 32);
    if (!song.byCut[cut]) song.byCut[cut] = { plays: 0, seconds: 0, completions: 0 };

    if (type === 'play_start') {
      song.plays += 1;
      song.byCut[cut].plays += 1;
      song.lastPlayedAt = now;
      dayPatch.plays = (dayPatch.plays || 0) + 1;
      if (page) {
        if (!agg.paths[page]) agg.paths[page] = { page: page, lands: 0, plays: 0 };
        agg.paths[page].plays += 1;
      }
    }

    const seconds = Math.max(0, Math.min(Number(event.seconds) || 0, 60 * 60));
    const delta = Math.max(0, seconds - (Number(event.prevSeconds) || 0));
    // Heartbeats are ~15s; allow larger catch-up on play_end / tab return.
    const maxDelta = type === 'play_end' ? 30 * 60 : 90;
    if (delta > 0 && delta <= maxDelta) {
      song.seconds += delta;
      song.byCut[cut].seconds += delta;
      dayPatch.seconds = (dayPatch.seconds || 0) + delta;
    }

    if (type === 'play_end' && event.completed) {
      song.completions += 1;
      song.byCut[cut].completions += 1;
      dayPatch.completions = (dayPatch.completions || 0) + 1;
    }
    return;
  }

  if (type === 'outbound') {
    const dest = String(event.dest || 'other').slice(0, 32);
    if (!agg.outbound[dest]) agg.outbound[dest] = { dest: dest, clicks: 0 };
    agg.outbound[dest].clicks += 1;
    dayPatch.outbound = (dayPatch.outbound || 0) + 1;
  }
}

async function ingestEvents(store, events) {
  const agg = await readAggregates(store);
  const dayPatches = {};

  (events || []).forEach(function (event) {
    if (!event || typeof event !== 'object') return;
    const dk = dayKey(event.ts);
    if (!dayPatches[dk]) dayPatches[dk] = {};
    applyEvent(agg, event, dayPatches[dk]);
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

  await writeAggregates(store, agg);

  const dayKeys = Object.keys(dayPatches);
  for (let i = 0; i < dayKeys.length; i++) {
    await bumpDay(store, dayKeys[i] + 'T12:00:00.000Z', dayPatches[dayKeys[i]]);
  }

  return agg;
}

async function recordCommerceOrder(store, order) {
  const commerce = await readCommerce(store);
  const kind = order.kind === 'tip' || order.kind === 'digital' || order.kind === 'shop' ? order.kind : 'shop';
  const cents = Math.max(0, Math.round(Number(order.cents) || 0));
  commerce[kind].count += 1;
  commerce[kind].cents += cents;
  commerce.recent.unshift({
    kind: kind,
    cents: cents,
    productTitle: String(order.productTitle || '').slice(0, 120),
    at: order.at || new Date().toISOString(),
    id: String(order.id || '').slice(0, 80)
  });
  commerce.recent = commerce.recent.slice(0, MAX_RECENT_ORDERS);
  await writeCommerce(store, commerce);
  return commerce;
}

async function readRecentDays(store, days) {
  const n = Math.max(1, Math.min(Number(days) || 14, 90));
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = 'days/' + d.toISOString().slice(0, 10);
    const row = await store.get(key, { type: 'json' });
    if (row && typeof row === 'object') {
      out.push(row);
    } else {
      out.push({
        date: d.toISOString().slice(0, 10),
        plays: 0,
        seconds: 0,
        lands: 0,
        outbound: 0,
        completions: 0
      });
    }
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
  AGG_KEY,
  COMMERCE_KEY
};
