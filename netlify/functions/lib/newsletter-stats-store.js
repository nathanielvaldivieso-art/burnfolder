'use strict';

const { getStore, connectLambda } = require('@netlify/blobs');

const STORE_NAME = 'burnfolder-newsletter';
const BLASTS_KEY = 'newsletter-blasts';
const MAX_BLASTS = 500;

function newsletterStore(event) {
  if (event) connectLambda(event);
  return getStore(STORE_NAME);
}

async function readBlasts(store) {
  const data = await store.get(BLASTS_KEY, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

async function appendBlast(store, blast) {
  const list = await readBlasts(store);
  const row = {
    id: String(blast.id || 'b_' + Date.now().toString(36)),
    at: String(blast.at || new Date().toISOString()),
    kind: String(blast.kind || 'entry').slice(0, 32),
    campaign: String(blast.campaign || '').slice(0, 80),
    entry: blast.entry ? String(blast.entry).slice(0, 40) : null,
    sent: Math.max(0, Math.round(Number(blast.sent) || 0)),
    failed: Math.max(0, Math.round(Number(blast.failed) || 0))
  };
  list.push(row);
  while (list.length > MAX_BLASTS) list.shift();
  await store.setJSON(BLASTS_KEY, list);
  return row;
}

function isNewsletterUtm(row) {
  if (!row) return false;
  const source = String(row.source || '').toLowerCase();
  const medium = String(row.medium || '').toLowerCase();
  if (source === 'newsletter' && (medium === 'email' || medium === 'newsletter')) return true;
  const campaign = String(row.campaign || '').toLowerCase();
  return campaign.indexOf('entry-') === 0 || campaign === 'welcome';
}

function summarizeEmail(parts) {
  const blasts = Array.isArray(parts.blasts) ? parts.blasts : [];
  const sinceMs = parts.sinceIso ? new Date(parts.sinceIso).getTime() : 0;
  const untilMs = parts.untilIso ? new Date(parts.untilIso).getTime() : Date.now() + 86400000;

  const inPeriod = blasts.filter(function (b) {
    const at = new Date(b.at).getTime();
    if (!Number.isFinite(at)) return false;
    if (sinceMs && at < sinceMs) return false;
    if (at > untilMs) return false;
    return true;
  });

  const sent = inPeriod.reduce(function (sum, b) {
    return sum + (Number(b.sent) || 0);
  }, 0);
  const failed = inPeriod.reduce(function (sum, b) {
    return sum + (Number(b.failed) || 0);
  }, 0);

  const utmRows = Array.isArray(parts.utm) ? parts.utm : [];
  const newsletterLands = utmRows
    .filter(isNewsletterUtm)
    .reduce(function (sum, row) {
      return sum + (Number(row.lands) || 0);
    }, 0);

  const byCampaign = {};
  inPeriod.forEach(function (b) {
    const key = b.campaign || b.kind || 'blast';
    if (!byCampaign[key]) {
      byCampaign[key] = {
        campaign: key,
        kind: b.kind || 'entry',
        entry: b.entry || null,
        sent: 0,
        failed: 0,
        lands: 0,
        at: b.at
      };
    }
    byCampaign[key].sent += Number(b.sent) || 0;
    byCampaign[key].failed += Number(b.failed) || 0;
    if (b.at > byCampaign[key].at) byCampaign[key].at = b.at;
  });

  utmRows.filter(isNewsletterUtm).forEach(function (row) {
    const campaign = String(row.campaign || '').trim() || 'newsletter';
    if (!byCampaign[campaign]) {
      byCampaign[campaign] = {
        campaign: campaign,
        kind: campaign === 'welcome' ? 'welcome' : 'entry',
        entry: campaign.indexOf('entry-') === 0 ? campaign.slice(6) : null,
        sent: 0,
        failed: 0,
        lands: 0,
        at: null
      };
    }
    byCampaign[campaign].lands += Number(row.lands) || 0;
  });

  const campaigns = Object.keys(byCampaign)
    .map(function (k) {
      const row = byCampaign[k];
      const rate = row.sent > 0 ? Math.round((row.lands / row.sent) * 1000) / 10 : null;
      return {
        campaign: row.campaign,
        kind: row.kind,
        entry: row.entry,
        sent: row.sent,
        failed: row.failed,
        lands: row.lands,
        clickRate: rate,
        at: row.at
      };
    })
    .sort(function (a, b) {
      return String(b.at || '').localeCompare(String(a.at || '')) || (b.sent || 0) - (a.sent || 0);
    })
    .slice(0, 20);

  const clickRate = sent > 0 ? Math.round((newsletterLands / sent) * 1000) / 10 : null;

  return {
    subscribers: parts.subscribers != null ? parts.subscribers : null,
    sent: sent,
    failed: failed,
    lands: newsletterLands,
    clickRate: clickRate,
    blasts: inPeriod.slice().reverse().slice(0, 20),
    campaigns: campaigns,
    trackingNote:
      'click rate = email-link lands (utm newsletter) ÷ emails sent. tagged links only — older blasts without utm will not count.'
  };
}

module.exports = {
  STORE_NAME,
  BLASTS_KEY,
  newsletterStore,
  readBlasts,
  appendBlast,
  isNewsletterUtm,
  summarizeEmail
};
