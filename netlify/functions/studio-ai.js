'use strict';

const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');

const COPY_BLOCK =
  /write (my|the|an?) entry|write (copy|caption|lyrics|caption)|generate (copy|caption|lyrics|entry)|draft (copy|entry text)|compose (my|the) entry/i;

function corsHeaders() {
  return studioCorsHeaders('POST, OPTIONS');
}

function systemPrompt(access) {
  return (
    'You are Burnfolder Studio assistant for workspace "' +
    (access.name || access.slug || 'studio') +
    '". Role: ops and analytics — digest streaming service data (streams, listeners, trends), release planning, checklists, capability answers. ' +
    'When a metricsSnapshot JSON is provided, treat it as ground truth: summarize patterns, compare fields that exist, and suggest focus. ' +
    'Do not invent numbers, platforms, or trends that are not in the snapshot. If a lane is empty or pending, say so. ' +
    'NEVER write entry copy, captions, lyrics, or marketing text. ' +
    'Gallery voice: lowercase, sparse, archival — artist writes all published text.'
  );
}

async function callAnthropic(message, access, metricsSnapshot) {
  const model = process.env.AI_MODEL || 'claude-haiku-4-5';
  let userContent = message;
  if (metricsSnapshot && typeof metricsSnapshot === 'object') {
    userContent =
      message +
      '\n\nmetricsSnapshot (ground truth — do not invent beyond this):\n' +
      JSON.stringify(metricsSnapshot).slice(0, 12000);
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 1024,
      system: systemPrompt(access),
      messages: [{ role: 'user', content: userContent }]
    })
  });
  const data = await res.json().catch(function () {
    return {};
  });
  if (!res.ok) {
    throw new Error(data.error && data.error.message ? data.error.message : 'AI request failed');
  }
  const block = Array.isArray(data.content) ? data.content.find(function (b) { return b.type === 'text'; }) : null;
  return block && block.text ? block.text : '';
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 503, headers, body: JSON.stringify({ message: 'AI not configured' }) };
  }

  const access = await requireWorkspaceAccess(event, { requireWrite: false });
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'message required' }) };
  }

  if (COPY_BLOCK.test(message)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        message:
          'Studio AI does not write entry copy, captions, or lyrics. Ask about streaming trends, release planning, or what studio can publish.'
      })
    };
  }

  const metricsSnapshot =
    body.metricsSnapshot && typeof body.metricsSnapshot === 'object' ? body.metricsSnapshot : null;

  try {
    const reply = await callAnthropic(message, access, metricsSnapshot);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, reply: reply }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'AI failed' }) };
  }
};
