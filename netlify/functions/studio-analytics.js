'use strict';

const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');
const { getStore, connectLambda } = require('@netlify/blobs');
const {
  analyticsStore,
  readAggregates,
  readCommerce,
  readRecentDays
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
  return Math.round((Number(cents) || 0)) / 100;
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

async function shareLinkSummary(event) {
  try {
    const store = shareStore(event);
    const shares = await listShares(store, {});
    const active = shares.filter(function (s) {
      return !s.revokedAt;
    });
    const totalPlays = active.reduce(function (sum, s) {
      return sum + (Number(s.playCount) || 0);
    }, 0);
    const top = active
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
      totalPlays: totalPlays,
      top: top
    };
  } catch (error) {
    return { linkCount: 0, totalPlays: 0, top: [], error: error.message || 'share links unavailable' };
  }
}

async function cloudflareSummary() {
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

  const since = new Date(Date.now() - 7 * 86400000).toISOString();
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
      windowDays: 7,
      pageviews: row ? Number(row.count) || 0 : 0,
      visits: row && row.sum ? Number(row.sum.visits) || 0 : 0
    };
  } catch (error) {
    return { configured: true, error: error.message || 'Cloudflare fetch failed' };
  }
}

function buildSnapshot(parts) {
  const agg = parts.aggregates || {};
  const songs = sortByPlays(
    Object.keys(agg.songs || {}).map(function (k) {
      return agg.songs[k];
    })
  ).slice(0, 20);

  const paths = Object.keys(agg.paths || {})
    .map(function (k) {
      return agg.paths[k];
    })
    .sort(function (a, b) {
      return (b.lands || 0) + (b.plays || 0) - ((a.lands || 0) + (a.plays || 0));
    })
    .slice(0, 12);

  const utm = Object.keys(agg.utm || {})
    .map(function (k) {
      return agg.utm[k];
    })
    .sort(function (a, b) {
      return (b.lands || 0) - (a.lands || 0);
    })
    .slice(0, 12);

  const referrers = Object.keys(agg.referrers || {})
    .map(function (k) {
      return agg.referrers[k];
    })
    .sort(function (a, b) {
      return (b.lands || 0) - (a.lands || 0);
    })
    .slice(0, 12);

  const outbound = Object.keys(agg.outbound || {})
    .map(function (k) {
      return agg.outbound[k];
    })
    .sort(function (a, b) {
      return (b.clicks || 0) - (a.clicks || 0);
    });

  const commerce = parts.commerce || {};
  const shares = parts.shares || {};

  return {
    generatedAt: new Date().toISOString(),
    site: {
      lands: (agg.lands && agg.lands.total) || 0,
      landsWithUtm: (agg.lands && agg.lands.withUtm) || 0,
      songPlays: songs.reduce(function (n, s) {
        return n + (s.plays || 0);
      }, 0),
      listenSeconds: songs.reduce(function (n, s) {
        return n + (s.seconds || 0);
      }, 0),
      completions: songs.reduce(function (n, s) {
        return n + (s.completions || 0);
      }, 0),
      updatedAt: agg.updatedAt || null
    },
    songs: songs,
    paths: paths,
    utm: utm,
    referrers: referrers,
    outbound: outbound,
    days: parts.days || [],
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
      recent: commerce.recent || [],
      updatedAt: commerce.updatedAt || null
    },
    newsletter: { subscribers: parts.newsletterCount },
    cloudflare: parts.cloudflare || { configured: false },
    dsp: {
      status: 'pending',
      note: 'Spotify for Artists + Apple Music for Artists + LabelGrid connect after DSP goes live (Tier 3).'
    }
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

  try {
    const store = analyticsStore(event);
    const [aggregates, commerce, days, shares, newsletterCountValue, cloudflare] = await Promise.all([
      readAggregates(store),
      readCommerce(store),
      readRecentDays(store, 14),
      shareLinkSummary(event),
      newsletterCount(event),
      cloudflareSummary()
    ]);

    const snapshot = buildSnapshot({
      aggregates: aggregates,
      commerce: commerce,
      days: days,
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
