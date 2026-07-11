'use strict';

const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');
const { getStore, connectLambda } = require('@netlify/blobs');
const {
  analyticsStore,
  readPeriodBuckets,
  normalizePeriod,
  PERIODS
} = require('./lib/site-analytics-store');
const { shareStore, listShares } = require('./lib/share-links-store');

function corsHeaders() {
  return studioCorsHeaders('GET, OPTIONS');
}

function sortByPlays(rows) {
  return rows.slice().sort(function (a, b) {
    return (b.plays || 0) - (a.plays || 0) || (b.seconds || 0) - (a.seconds || 0);
  });
}

function dollars(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

async function newsletterCount(event) {
  try {
    connectLambda(event);
    const store = getStore('burnfolder-newsletter');
    const list = await store.get('subscriber-emails', { type: 'json' });
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return null;
  }
}

async function shareLinkSummary(event, sinceIso) {
  try {
    const store = shareStore(event);
    const shares = await listShares(store, {});
    const active = shares.filter(function (s) {
      return !s.revokedAt;
    });
    const sinceMs = sinceIso ? new Date(sinceIso).getTime() : 0;
    const inPeriod = sinceIso
      ? active.filter(function (s) {
          const at = s.lastPlayedAt ? new Date(s.lastPlayedAt).getTime() : 0;
          return at >= sinceMs;
        })
      : active;
    const totalPlays = inPeriod.reduce(function (sum, s) {
      return sum + (Number(s.playCount) || 0);
    }, 0);
    const top = inPeriod
      .slice()
      .sort(function (a, b) {
        return (b.playCount || 0) - (a.playCount || 0);
      })
      .slice(0, 12)
      .map(function (s) {
        return {
          title: s.title,
          scope: s.scope,
          groupKey: s.groupKey || '',
          albumId: s.albumId || '',
          playCount: s.playCount || 0,
          lastPlayedAt: s.lastPlayedAt || null,
          createdAt: s.createdAt || null
        };
      });
    return {
      linkCount: active.length,
      activeInPeriod: inPeriod.length,
      totalPlays: totalPlays,
      top: top,
      playCountsAreLifetime: !!sinceIso
    };
  } catch (error) {
    return {
      linkCount: 0,
      activeInPeriod: 0,
      totalPlays: 0,
      top: [],
      error: error.message || 'share links unavailable'
    };
  }
}

async function cloudflareSummary(periodKey) {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const siteTag = (
    process.env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG ||
    process.env.CLOUDFLARE_SITE_TAG ||
    ''
  ).trim();

  if (!accountId || !apiToken || !siteTag) {
    return {
      configured: false,
      hint: 'Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_WEB_ANALYTICS_SITE_TAG to pull pageviews into Studio.'
    };
  }

  const days =
    periodKey === 'hour' || periodKey === 'day'
      ? 1
      : periodKey === 'week'
        ? 7
        : periodKey === 'month'
          ? 30
          : periodKey === 'year'
            ? 365
            : 7;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const query =
    'query {' +
    ' viewer {' +
    '  accounts(filter: { accountTag: "' +
    accountId +
    '" }) {' +
    '   rumPageloadEventsAdaptiveGroups(' +
    '     filter: { datetime_geq: "' +
    since +
    '", siteTag: "' +
    siteTag +
    '" },' +
    '     limit: 1' +
    '   ) { count sum { visits } }' +
    '  }' +
    ' }' +
    '}';

  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: query })
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      return {
        configured: true,
        error: (data.errors && data.errors[0] && data.errors[0].message) || 'Cloudflare request failed'
      };
    }
    const groups =
      data &&
      data.data &&
      data.data.viewer &&
      data.data.viewer.accounts &&
      data.data.viewer.accounts[0] &&
      data.data.viewer.accounts[0].rumPageloadEventsAdaptiveGroups;
    const row = Array.isArray(groups) && groups[0] ? groups[0] : null;
    return {
      configured: true,
      windowDays: days,
      pageviews: row ? Number(row.count) || 0 : 0,
      visits: row && row.sum ? Number(row.sum.visits) || 0 : 0
    };
  } catch (error) {
    return { configured: true, error: error.message || 'Cloudflare fetch failed' };
  }
}

function buildSnapshot(parts) {
  const bucket = parts.bucket || {};
  const songs = sortByPlays(
    Object.keys(bucket.songs || {}).map(function (k) {
      return bucket.songs[k];
    })
  ).slice(0, 20);

  const paths = Object.keys(bucket.paths || {})
    .map(function (k) {
      return bucket.paths[k];
    })
    .sort(function (a, b) {
      return (b.lands || 0) + (b.plays || 0) - ((a.lands || 0) + (a.plays || 0));
    })
    .slice(0, 12);

  const utm = Object.keys(bucket.utm || {})
    .map(function (k) {
      return bucket.utm[k];
    })
    .sort(function (a, b) {
      return (b.lands || 0) - (a.lands || 0);
    })
    .slice(0, 12);

  const referrers = Object.keys(bucket.referrers || {})
    .map(function (k) {
      return bucket.referrers[k];
    })
    .sort(function (a, b) {
      return (b.lands || 0) - (a.lands || 0);
    })
    .slice(0, 12);

  const outbound = Object.keys(bucket.outboundByDest || {})
    .map(function (k) {
      return bucket.outboundByDest[k];
    })
    .sort(function (a, b) {
      return (b.clicks || 0) - (a.clicks || 0);
    });

  const pathways = Object.keys(bucket.pathways || {})
    .map(function (k) {
      return bucket.pathways[k];
    })
    .sort(function (a, b) {
      return (b.count || 0) - (a.count || 0);
    })
    .slice(0, 20);

  const commerce = bucket.commerce || {};
  const shares = parts.shares || {};
  const window = parts.window || {};

  return {
    generatedAt: new Date().toISOString(),
    period: window.period || 'week',
    periodLabel: (PERIODS[window.period] && PERIODS[window.period].label) || window.period,
    since: window.since || null,
    until: window.until || null,
    site: {
      lands: Number(bucket.lands) || 0,
      landsWithUtm: Number(bucket.landsWithUtm) || 0,
      songPlays: Number(bucket.plays) || songs.reduce(function (n, s) {
        return n + (s.plays || 0);
      }, 0),
      listenSeconds: Number(bucket.seconds) || 0,
      completions: Number(bucket.completions) || 0,
      outbound: Number(bucket.outbound) || 0,
      updatedAt: bucket.updatedAt || null
    },
    songs: songs,
    paths: paths,
    pathways: pathways,
    utm: utm,
    referrers: referrers,
    outbound: outbound,
    series: parts.series || [],
    shares: shares,
    commerce: {
      tips: {
        count: (commerce.tips && commerce.tips.count) || 0,
        dollars: dollars(commerce.tips && commerce.tips.cents)
      },
      digital: {
        count: (commerce.digital && commerce.digital.count) || 0,
        dollars: dollars(commerce.digital && commerce.digital.cents)
      },
      shop: {
        count: (commerce.shop && commerce.shop.count) || 0,
        dollars: dollars(commerce.shop && commerce.shop.cents)
      },
      recent: parts.commerceRecent || [],
      updatedAt: null
    },
    newsletter: { subscribers: parts.newsletterCount },
    cloudflare: parts.cloudflare || { configured: false },
    dsp: {
      status: 'pending',
      note: 'Spotify for Artists + Apple Music for Artists + LabelGrid connect after DSP goes live (Tier 3).'
    },
    periods: Object.keys(PERIODS)
  };
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const access = await requireWorkspaceAccess(event, { requireWrite: false });
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  const qs = event.queryStringParameters || {};
  const period = normalizePeriod(qs.period || 'week');

  try {
    const store = analyticsStore(event);
    const periodData = await readPeriodBuckets(store, period);
    const [shares, newsletterCountValue, cloudflare] = await Promise.all([
      shareLinkSummary(event, periodData.window.since),
      newsletterCount(event),
      cloudflareSummary(period)
    ]);

    const snapshot = buildSnapshot({
      window: periodData.window,
      bucket: periodData.bucket,
      series: periodData.series,
      commerceRecent: periodData.commerceRecent,
      shares: shares,
      newsletterCount: newsletterCountValue,
      cloudflare: cloudflare
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, snapshot: snapshot })
    };
  } catch (error) {
    console.error('studio-analytics:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: error.message || 'analytics failed' })
    };
  }
};
