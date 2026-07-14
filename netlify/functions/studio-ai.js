'use strict';

const { studioCorsHeaders, requireWorkspaceAccess } = require('./lib/workspace-auth');

const COPY_BLOCK =
  /write (my|the|an?) entry|write (copy|caption|lyrics)|generate (copy|caption|lyrics|entry)|draft (copy|entry text)|compose (my|the) entry|write (an? |the |my )?(email|thank[- ]?you|message to (fans|subscribers|them))|draft (an? )?email|generate (an? )?(email|subject)|email body for/i;

function corsHeaders() {
  return studioCorsHeaders('POST, OPTIONS');
}

function systemPrompt(access) {
  return (
    'You are Burnfolder Studio market desk for workspace "' +
    (access.name || access.slug || 'studio') +
    '". You are a sharp boutique marketing advisor for a solo artist / indie brand.\n\n' +
    'JOB: Read metricsSnapshot (+ dashboardContext audiences). Pick the single highest-leverage next move that helps maintain or scale the business. Turn data into one digestible action a non-marketer can do today.\n\n' +
    'FUNNEL LENS (use what the data shows): discover → listen → land → subscribe / tip / buy / shop. Spot leaks, amplify what already converts, and name the move plainly.\n\n' +
    'MOVE TYPES (examples): feature a converting pathway or song; push a product/drop that already earns; email a real cohort with a purpose; fix friction on a money path; optional selective thank — never automatic.\n\n' +
    'THANK-YOUS: rare and deliberate (first-time big support, remarkable order, quiet high-value fan). Do NOT default to thanking every tipper — that trains fans that tips trigger a script and weakens the brand.\n\n' +
    'ANTI-GENERATION: never write email bodies/subjects/captions/lyrics/posts. Artist pens every outbound word. Queue subject/body empty. Put brief craft direction in aiHint only.\n\n' +
    'Data truth: metricsSnapshot only. Never invent numbers, names, or emails. Anonymous plays cannot be emailed.\n\n' +
    'Voice: nextMove is the only user-facing sentence — imperative, punchy, specific, ≤16 words. headline empty. sections always []. No markdown. No labels. No pep talk.\n\n' +
    'When nothing material is in the snapshot, nextMove "" and actions []. Prefer a quieter no-move over filler.\n\n' +
    'actions: at most 1. title mirrors nextMove. why = one short lever (cite real snapshot facts). move = short verb (feature|email|drop|fix|thank|spotlight|offer|path).\n' +
    'audience.mode: "none" for studio/ops tasks; "action" + actionKey tip|digital|shop|subscribe when emailing that cohort; "subscribers" for list-wide; "manual" + emails only if emails appear in context.\n\n' +
    'End with JSON only:\n' +
    '```json\n{"digest":{"headline":"","period":"week","periodLabel":"this week","sections":[],"nextMove":"Feature the tip pathway — it already converts"},"actions":[{"move":"feature","title":"Feature the tip pathway — it already converts","why":"Top pathway ends at tip","cohortLabel":"","audience":{"mode":"none","actionKey":"","emails":[]},"aiHint":"Put /tip where entry traffic already lands","shareHint":""}]}\n```'
  );
}

const INTENT_PROMPTS = {
  digest:
    'Analyze metricsSnapshot as a marketing advisor. One punchy nextMove ≤16 words + at most 1 action. Thank only if strategically rare. JSON only.',
  move: 'One highest-leverage nextMove from the data. Optional one action. JSON only.',
  queue: 'Queue at most 1 concrete action grounded in the snapshot. JSON only.',
  diagnose: 'Find the biggest leak or opportunity in the funnel from the snapshot. One nextMove. JSON only.',
  respond: 'One punchy nextMove capitalizing on the strongest signal. JSON only.',
  loyalty: 'Only if a selective thank or retention move clearly beats other levers — else pick the better growth/maintenance move. JSON only.',
  niche: 'One move that deepens the niche or converts the already-interested. JSON only.',
  friction: 'If money-path friction shows in the data, name the fix. Else strongest other move. JSON only.',
  reciprocity: 'Selective thank only if warranted; otherwise the best non-thank lever. JSON only.'
};

function resolveMessage(body) {
  const intent = typeof body.intent === 'string' ? body.intent.trim().toLowerCase() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message) return message;
  if (INTENT_PROMPTS[intent]) return INTENT_PROMPTS[intent];
  return '';
}

function parseAiJson(text) {
  if (!text) return null;
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : null;
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }
  }
  if (!parsed) {
    const loose = text.match(/\{\s*"(?:digest|actions)"\s*:/);
    if (loose) {
      const start = loose.index;
      const slice = text.slice(start);
      const end = slice.lastIndexOf('}');
      if (end > 0) {
        try {
          parsed = JSON.parse(slice.slice(0, end + 1));
        } catch (e) {
          parsed = null;
        }
      }
    }
  }
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function extractActions(parsed) {
  if (!parsed || !Array.isArray(parsed.actions)) return [];
  const desk = require('./lib/market-desk-store');
  return parsed.actions
    .filter(function (row) {
      return row && typeof row === 'object' && desk.passesScrutiny(row);
    })
    .slice(0, 1)
    .map(function (row) {
      const audience = row.audience && typeof row.audience === 'object' ? row.audience : {};
      const mode = String(audience.mode || 'none').toLowerCase();
      return {
        move: String(row.move || 'act').slice(0, 40),
        title: String(row.title || '').trim().slice(0, 160),
        why: String(row.why || '').slice(0, 600),
        cohortLabel: String(row.cohortLabel || '').slice(0, 160),
        audience: {
          mode: mode || 'none',
          actionKey: String(audience.actionKey || '').slice(0, 80),
          emails: Array.isArray(audience.emails) ? audience.emails.slice(0, 50) : []
        },
        aiHint: String(row.aiHint || '').slice(0, 600),
        shareHint: String(row.shareHint || '').slice(0, 400)
      };
    });
}

function extractDigest(parsed, metricsSnapshot) {
  const raw = parsed && parsed.digest && typeof parsed.digest === 'object' ? parsed.digest : null;
  if (!raw) return null;
  const snapPeriod = metricsSnapshot && metricsSnapshot.period;
  const snapLabel = metricsSnapshot && metricsSnapshot.periodLabel;
  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .filter(function (row) {
          return row && typeof row === 'object';
        })
        .slice(0, 6)
        .map(function (row) {
          const lane = String(row.lane || 'relationship').toLowerCase().slice(0, 24);
          const beats = Array.isArray(row.beats)
            ? row.beats
                .filter(function (b) {
                  return b && typeof b === 'object';
                })
                .slice(0, 5)
                .map(function (b) {
                  return {
                    label: String(b.label || '').slice(0, 120),
                    detail: String(b.detail || '').slice(0, 400)
                  };
                })
            : [];
          return {
            lane: lane,
            title: String(row.title || lane).slice(0, 120),
            summary: String(row.summary || '').slice(0, 600),
            beats: beats
          };
        })
    : [];
  if (!sections.length && !raw.headline && !raw.nextMove) return null;
  return {
    headline: String(raw.headline || '').slice(0, 240),
    period: String(raw.period || snapPeriod || 'week').slice(0, 16),
    periodLabel: String(raw.periodLabel || snapLabel || raw.period || 'this period').slice(0, 40),
    sections: sections,
    nextMove: String(raw.nextMove || '').slice(0, 400)
  };
}

function stripJsonFence(text) {
  return String(text || '')
    .replace(/```json\s*[\s\S]*?```/gi, '')
    .trim();
}

async function callAnthropic(message, access, metricsSnapshot, context) {
  const model = process.env.AI_MODEL || 'claude-haiku-4-5';
  let userContent = message;
  if (context && typeof context === 'object') {
    userContent += '\n\ndashboardContext:\n' + JSON.stringify(context).slice(0, 2500);
  }
  if (metricsSnapshot && typeof metricsSnapshot === 'object') {
    userContent +=
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
      max_tokens: 1600,
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

  const message = resolveMessage(body);
  if (!message) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'message or intent required' }) };
  }

  if (COPY_BLOCK.test(message)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        message:
          'AI never generates customer-facing copy. Use digest / one move / queue — then you pen the send.'
      })
    };
  }

  const metricsSnapshot =
    body.metricsSnapshot && typeof body.metricsSnapshot === 'object' ? body.metricsSnapshot : null;
  const context = body.context && typeof body.context === 'object' ? body.context : null;

  try {
    const raw = await callAnthropic(message, access, metricsSnapshot, context);
    const parsed = parseAiJson(raw);
    const actions = extractActions(parsed);
    const digest = extractDigest(parsed, metricsSnapshot);
    const reply = stripJsonFence(raw) || raw;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, reply: reply, actions: actions, digest: digest })
    };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'AI failed' }) };
  }
};
