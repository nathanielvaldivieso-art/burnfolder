const { studioCorsHeaders, requireStudioAccess } = require('./lib/studio-auth');
const publish = require('../../shared/publish-artifacts.js');
const entriesFile = require('./lib/entries-file');
const github = require('./lib/github-commit');

const DATE_PATTERN = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/;
const MAX_BLOCKS = 120;
const MAX_BODY_BYTES = 900000;

function corsHeaders() {
  return studioCorsHeaders('POST, OPTIONS');
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return null;
  }
}

function validatePhaseA(blocks) {
  for (let i = 0; i < (blocks || []).length; i++) {
    const block = blocks[i];
    if (!block || !block.type) continue;

    if (block.type === 'image' && block.src && String(block.src).trim()) {
      return 'Phase A publish cannot upload image files yet. Remove image blocks first.';
    }

    const cover = block.coverArt && String(block.coverArt).trim();
    if (cover && /^IMAGES\//i.test(cover)) {
      return 'Phase A publish cannot upload cover art files yet. Remove album cover images first.';
    }

    if (block.type === 'audio' || block.type === 'video') {
      if (!block.playbackId || !String(block.playbackId).trim()) {
        return 'Audio and video blocks need a Mux playback id.';
      }
    }

    if ((block.type === 'album' || block.type === 'playlist') && Array.isArray(block.tracks)) {
      for (let t = 0; t < block.tracks.length; t++) {
        const track = block.tracks[t];
        if (!track || !track.playbackId || !String(track.playbackId).trim()) {
          return 'Every album / playlist track needs a Mux playback id.';
        }
      }
    }
  }
  return null;
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const access = requireStudioAccess(event);
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  const body = parseBody(event);
  if (!body) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
  }

  if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY_BYTES) {
    return { statusCode: 413, headers, body: JSON.stringify({ message: 'Entry payload is too large' }) };
  }

  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const blocks = Array.isArray(body.blocks) ? body.blocks : null;
  const republish = body.republish === true;

  if (!DATE_PATTERN.test(date)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ message: 'Invalid date key. Use M.DD.YY (e.g. 6.4.26).' })
    };
  }

  if (!blocks || !blocks.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Entry needs at least one block' }) };
  }

  if (blocks.length > MAX_BLOCKS) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Too many blocks in entry' }) };
  }

  const phaseError = validatePhaseA(blocks);
  if (phaseError) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: phaseError }) };
  }

  try {
    if (!process.env.GITHUB_TOKEN) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          message: 'Publish is not configured. Add GITHUB_TOKEN to Netlify environment variables.'
        })
      };
    }

    const octokit = github.createOctokit();
    const cfg = github.getRepoConfig();
    const htmlPath = date + '.html';

    if (!republish) {
      const existsHtml = await github.fileExists(octokit, cfg, htmlPath);
      if (existsHtml) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({
            message: 'An entry page for "' + date + '" already exists on burnfolder.com.'
          })
        };
      }
    }

    const entriesRemote = await github.getFileText(octokit, cfg, 'entries.js');
    if (!entriesRemote) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: 'Could not read entries.js from GitHub.' })
      };
    }

    const parsed = entriesFile.parseEntriesJs(entriesRemote.content);
    if (!republish && parsed.entryDataByDate[date]) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          message: 'entries.js already has data for "' + date + '".'
        })
      };
    }

    entriesFile.mergeEntry(parsed, date, blocks, republish);

    const normalized = {
      date: date,
      blocks: publish.stripEditorIds(blocks).map(publish.cleanBlockForData)
    };

    const artifacts = publish.buildPublishArtifacts(normalized, {
      scriptVersion: publish.SCRIPT_VERSION,
      existingJournal: []
    });

    const nextEntriesJs = entriesFile.serializeEntriesJs(parsed);

    const commit = await github.commitFiles('Publish studio entry ' + date, [
      { path: htmlPath, content: artifacts.entryHtml },
      { path: 'entries.js', content: nextEntriesJs }
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        date: date,
        publishUrl: artifacts.publishUrl,
        commitSha: commit.sha,
        commitUrl: commit.url,
        message:
          'Published ' +
          date +
          '. Netlify will deploy shortly and subscribers will be notified.'
      })
    };
  } catch (error) {
    console.error('studio-publish error:', error);
    const status = error.code === 'ENTRY_EXISTS' ? 409 : 500;
    return {
      statusCode: status,
      headers,
      body: JSON.stringify({ message: error.message || 'Publish failed' })
    };
  }
};
