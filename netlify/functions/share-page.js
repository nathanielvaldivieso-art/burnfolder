'use strict';

/**
 * Serves the private share page (/w?t=token) with per-link preview metadata.
 *
 * The static watch.html/listen.html can only advertise a generic "watch" title,
 * because the clip is chosen client-side from the token. Messaging apps don't run
 * that JS, so every link previewed identically. Here the share is looked up on the
 * server and the real title plus a video poster frame are injected into the head.
 */

const fs = require('fs');
const path = require('path');
const {
  shareStore,
  getShare,
  shareUnavailableReason,
  isVideoShare,
  muxPreviewImageUrl
} = require('./lib/share-links-store');

const TEMPLATE_VIDEO = 'watch.html';
const TEMPLATE_AUDIO = 'listen.html';

function htmlHeaders() {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    // Private links: never let a shared cache hold one person's page.
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow'
  };
}

function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function siteOrigin(event) {
  const host = event.headers.host || event.headers.Host || 'burnfolder.com';
  let proto = (event.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (!proto) {
    proto = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? 'http' : 'https';
  }
  return proto + '://' + host;
}

async function loadTemplate(name, origin) {
  const candidates = [
    path.join(process.cwd(), name),
    path.resolve(__dirname, '..', '..', name),
    path.resolve(__dirname, '..', '..', '..', name)
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    try {
      return fs.readFileSync(candidates[i], 'utf8');
    } catch (error) {
      /* try next */
    }
  }
  // Bundled copy missing — fall back to the deployed static file. /w is the only
  // rewritten path, so fetching the .html directly cannot loop back here.
  try {
    const res = await fetch(origin + '/' + name);
    if (res.ok) return await res.text();
  } catch (error) {
    /* fall through */
  }
  return null;
}

function absoluteUrl(origin, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return origin + '/' + raw.replace(/^\//, '');
}

function previewFor(share, origin, pageUrl) {
  const video = isVideoShare(share);
  const tracks = (share.tracks || []).filter(function (t) {
    return t && t.playbackId;
  });
  const count = tracks.length;

  const parts = ['private ' + (video ? 'video' : 'listen') + ' link'];
  if (count > 1) parts.push(count + ' ' + (video ? 'clips' : 'tracks'));
  if (share.oneTime) parts.push('one-time');
  if (share.expiresAt) {
    const ms = Date.parse(share.expiresAt);
    if (Number.isFinite(ms)) {
      parts.push('expires ' + new Date(ms).toISOString().slice(0, 10));
    }
  }

  let image = '';
  if (video && count) image = muxPreviewImageUrl(tracks[0].playbackId);
  else if (share.coverArt) image = absoluteUrl(origin, share.coverArt);

  return {
    title: share.title || 'private link',
    description: parts.join(' · '),
    image: image,
    type: video ? 'video.other' : 'music.song',
    url: pageUrl
  };
}

function genericPreview(pageUrl) {
  return {
    title: 'private link — burnfolder',
    description: 'this private link is no longer available',
    image: '',
    type: 'website',
    url: pageUrl
  };
}

function metaTags(preview) {
  const tags = [
    '<meta property="og:site_name" content="burnfolder">',
    '<meta property="og:type" content="' + escapeAttr(preview.type) + '">',
    '<meta property="og:title" content="' + escapeAttr(preview.title) + '">',
    '<meta property="og:description" content="' + escapeAttr(preview.description) + '">',
    '<meta name="description" content="' + escapeAttr(preview.description) + '">'
  ];
  if (preview.url) {
    tags.push('<meta property="og:url" content="' + escapeAttr(preview.url) + '">');
  }
  if (preview.image) {
    tags.push('<meta property="og:image" content="' + escapeAttr(preview.image) + '">');
    tags.push('<meta property="og:image:width" content="1200">');
    tags.push('<meta name="twitter:card" content="summary_large_image">');
    tags.push('<meta name="twitter:image" content="' + escapeAttr(preview.image) + '">');
  } else {
    tags.push('<meta name="twitter:card" content="summary">');
  }
  tags.push('<meta name="twitter:title" content="' + escapeAttr(preview.title) + '">');
  tags.push('<meta name="twitter:description" content="' + escapeAttr(preview.description) + '">');
  return tags.join('\n  ');
}

function injectPreview(html, preview) {
  let out = html.replace(
    /<title>[\s\S]*?<\/title>/i,
    '<title>' + escapeAttr(preview.title) + ' — burnfolder</title>'
  );
  const tags = '  ' + metaTags(preview) + '\n';
  if (out.indexOf('</head>') > -1) {
    out = out.replace('</head>', tags + '</head>');
  }
  return out;
}

exports.handler = async function (event) {
  const origin = siteOrigin(event);
  const params = event.queryStringParameters || {};
  const token = String(params.t || '').trim();
  const pageUrl = origin + '/w?t=' + encodeURIComponent(token);

  let share = null;
  if (token) {
    try {
      share = await getShare(shareStore(event), token);
    } catch (error) {
      share = null;
    }
  }

  // Don't advertise the title of a dead link.
  const usable = share && !shareUnavailableReason(share);
  const template = usable && !isVideoShare(share) ? TEMPLATE_AUDIO : TEMPLATE_VIDEO;
  const html = await loadTemplate(template, origin);

  if (!html) {
    // Preview enrichment must never cost someone the page itself.
    return {
      statusCode: 302,
      headers: { Location: '/' + template + '?t=' + encodeURIComponent(token), 'Cache-Control': 'no-store' },
      body: ''
    };
  }

  const preview = usable ? previewFor(share, origin, pageUrl) : genericPreview(pageUrl);
  return { statusCode: 200, headers: htmlHeaders(), body: injectPreview(html, preview) };
};
