'use strict';

const {
  studioCorsHeaders,
  requireWorkspaceAccess,
  canPublish
} = require('./lib/workspace-auth');
const { getProvider, getProviderName } = require('./lib/distribution/distribution.interface');
const { getStateStore, readLogical, writeLogical } = require('./lib/studio-state-store');

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return null;
  }
}

function emptyPrefs() {
  return {
    provider: 'labelgrid',
    labelId: null,
    artistId: null,
    writerId: null,
    primaryGenreId: null,
    rightsName: '',
    audioLanguage: 'en',
    artworkAiUsage: 'none',
    catalogPrefix: 'BF',
    lastSyncAt: null
  };
}

function normalizePrefs(value) {
  const base = emptyPrefs();
  if (!value || typeof value !== 'object') return base;
  return {
    provider: 'labelgrid',
    labelId: value.labelId != null ? Number(value.labelId) || null : null,
    artistId: value.artistId != null ? Number(value.artistId) || null : null,
    writerId: value.writerId != null ? Number(value.writerId) || null : null,
    primaryGenreId: value.primaryGenreId != null ? Number(value.primaryGenreId) || null : null,
    rightsName: typeof value.rightsName === 'string' ? value.rightsName : '',
    audioLanguage: typeof value.audioLanguage === 'string' ? value.audioLanguage : 'en',
    artworkAiUsage: typeof value.artworkAiUsage === 'string' ? value.artworkAiUsage : 'none',
    catalogPrefix: typeof value.catalogPrefix === 'string' ? value.catalogPrefix : 'BF',
    lastSyncAt: value.lastSyncAt || null
  };
}

function normalizeCatalog(value) {
  if (!value || typeof value !== 'object') return { releases: [] };
  const releases = Array.isArray(value.releases) ? value.releases : [];
  return { releases: releases };
}

function normalizeRegistry(value) {
  if (!value || typeof value !== 'object') return { tracks: [] };
  const tracks = Array.isArray(value.tracks) ? value.tracks : [];
  return { tracks: tracks };
}

function mergeTrackRegistry(registry, trackResults, status) {
  const next = normalizeRegistry(registry);
  const byId = {};
  next.tracks.forEach(function (row) {
    if (row && row.id) byId[row.id] = row;
  });

  (trackResults || []).forEach(function (result) {
    const id = result.studioTrackId || 'lg_' + result.providerTrackId;
    const prev = byId[id] || {};
    const lockedIsrc = prev.isrcLocked && prev.isrc ? prev.isrc : null;
    const nextIsrc = lockedIsrc || result.isrc || prev.isrc || null;
    byId[id] = {
      id: id,
      title: result.title || prev.title || '',
      vaultKey: result.vaultKey || prev.vaultKey || null,
      muxPlaybackId: prev.muxPlaybackId || null,
      providerTrackId: result.providerTrackId || prev.providerTrackId || null,
      isrc: nextIsrc,
      isrcLocked: !!(lockedIsrc || result.isrc),
      status: status || prev.status || 'distro_draft'
    };
  });

  return { tracks: Object.keys(byId).map(function (k) { return byId[k]; }) };
}

function upsertCatalogRelease(catalog, releaseRecord) {
  const next = normalizeCatalog(catalog);
  const idx = next.releases.findIndex(function (row) {
    return row && (row.id === releaseRecord.id || row.providerReleaseId === releaseRecord.providerReleaseId);
  });
  if (idx > -1) next.releases[idx] = Object.assign({}, next.releases[idx], releaseRecord);
  else next.releases.unshift(releaseRecord);
  return next;
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const isWrite = event.httpMethod === 'POST';
  const access = await requireWorkspaceAccess(event, { requireWrite: isWrite });
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  let provider;
  try {
    provider = getProvider();
  } catch (error) {
    return { statusCode: 503, headers, body: JSON.stringify({ message: error.message }) };
  }

  if (event.httpMethod === 'GET') {
    const action = (event.queryStringParameters && event.queryStringParameters.action) || 'status';
    try {
      if (action === 'status') {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            provider: getProviderName(),
            configured: provider.configured(),
            sandbox: String(process.env.LABELGRID_SANDBOX || '').toLowerCase() === 'true',
            apiBase: provider.apiBase ? provider.apiBase() : null
          })
        };
      }
      if (action === 'ping') {
        if (!access.isOwner) {
          return { statusCode: 403, headers, body: JSON.stringify({ message: 'Owner role required' }) };
        }
        const result = await provider.ping();
        return { statusCode: 200, headers, body: JSON.stringify(result) };
      }
      if (action === 'refs') {
        if (!access.isOwner) {
          return { statusCode: 403, headers, body: JSON.stringify({ message: 'Owner role required' }) };
        }
        const [labels, artists, genres] = await Promise.all([
          provider.listLabels(),
          provider.listArtists(),
          provider.listGenres()
        ]);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ labels: labels, artists: artists, genres: genres })
        };
      }
      if (action === 'release-status') {
        const id =
          (event.queryStringParameters && event.queryStringParameters.providerReleaseId) || '';
        const result = await provider.getReleaseStatus(id);
        return { statusCode: 200, headers, body: JSON.stringify(result) };
      }
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'Unknown action' }) };
    } catch (error) {
      return {
        statusCode: error.status || 500,
        headers,
        body: JSON.stringify({
          message: error.message || 'distro read failed',
          details: error.details || null
        })
      };
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const body = parseBody(event);
  if (!body) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
  }

  const action = body.action || '';

  try {
    const store = getStateStore(event);

    if (action === 'save-prefs') {
      if (!canPublish(access.role) && !access.isOwner) {
        return { statusCode: 403, headers, body: JSON.stringify({ message: 'Owner role required' }) };
      }
      const prefs = normalizePrefs(body.prefs);
      prefs.lastSyncAt = new Date().toISOString();
      await writeLogical(store, access.workspaceId, 'distroPreferences', prefs);
      return { statusCode: 200, headers, body: JSON.stringify({ prefs: prefs }) };
    }

    if (action === 'create') {
      const prefsRec = await readLogical(store, access.workspaceId, 'distroPreferences');
      const prefs = normalizePrefs(prefsRec.value);
      const release = body.release || {};
      if (!release.title || !Array.isArray(release.tracks) || !release.tracks.length) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ message: 'release.title and release.tracks are required' })
        };
      }
      for (let i = 0; i < release.tracks.length; i++) {
        if (!release.tracks[i].vaultKey) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              message: 'Each track needs a vaultKey (upload the master to R2 first)'
            })
          };
        }
      }

      const created = await provider.createRelease({
        workspaceId: access.workspaceId,
        prefs: prefs,
        release: release
      });

      const catalogRec = await readLogical(store, access.workspaceId, 'releaseCatalog');
      const registryRec = await readLogical(store, access.workspaceId, 'trackRegistry');
      const studioReleaseId = release.id || 'rel_' + Date.now().toString(36);

      const releaseRecord = {
        id: studioReleaseId,
        title: release.title,
        groupId: release.groupId || null,
        contentType: release.contentType || null,
        status: 'distro_draft',
        provider: 'labelgrid',
        providerReleaseId: created.providerReleaseId,
        publicId: created.publicId,
        upc: created.upc,
        catalogNumber: created.catalogNumber,
        artworkVaultKey: release.artworkVaultKey || null,
        releaseDate: release.releaseDate || null,
        tracks: created.tracks,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const nextCatalog = upsertCatalogRelease(catalogRec.value, releaseRecord);
      const nextRegistry = mergeTrackRegistry(registryRec.value, created.tracks, 'distro_draft');
      await writeLogical(store, access.workspaceId, 'releaseCatalog', nextCatalog);
      await writeLogical(store, access.workspaceId, 'trackRegistry', nextRegistry);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ release: releaseRecord, created: created })
      };
    }

    if (action === 'submit') {
      if (!canPublish(access.role) && !access.isOwner) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: 'Owner role required to submit to LabelGrid' })
        };
      }

      const providerReleaseId = body.providerReleaseId || body.releaseId;
      const submitted = await provider.submitRelease(providerReleaseId);

      const catalogRec = await readLogical(store, access.workspaceId, 'releaseCatalog');
      const catalog = normalizeCatalog(catalogRec.value);
      const idx = catalog.releases.findIndex(function (row) {
        return row && String(row.providerReleaseId) === String(providerReleaseId);
      });
      if (idx > -1) {
        catalog.releases[idx] = Object.assign({}, catalog.releases[idx], {
          status: 'distro_submitted',
          submittedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          providerStatus: submitted.status
        });
        await writeLogical(store, access.workspaceId, 'releaseCatalog', catalog);

        const registryRec = await readLogical(store, access.workspaceId, 'trackRegistry');
        const nextRegistry = mergeTrackRegistry(
          registryRec.value,
          catalog.releases[idx].tracks || [],
          'distro_submitted'
        );
        await writeLogical(store, access.workspaceId, 'trackRegistry', nextRegistry);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          submitted: submitted,
          release: idx > -1 ? catalog.releases[idx] : null
        })
      };
    }

    if (action === 'refresh-status') {
      const providerReleaseId = body.providerReleaseId;
      const status = await provider.getReleaseStatus(providerReleaseId);
      const catalogRec = await readLogical(store, access.workspaceId, 'releaseCatalog');
      const catalog = normalizeCatalog(catalogRec.value);
      const idx = catalog.releases.findIndex(function (row) {
        return row && String(row.providerReleaseId) === String(providerReleaseId);
      });
      if (idx > -1) {
        const liveHint =
          status.status && /live|delivered|complete/i.test(String(status.status))
            ? 'dsp_live'
            : catalog.releases[idx].status;
        catalog.releases[idx] = Object.assign({}, catalog.releases[idx], {
          upc: status.upc || catalog.releases[idx].upc,
          providerStatus: status.status,
          status: liveHint,
          tracks: (status.tracks || []).length
            ? status.tracks.map(function (t, i) {
                const prev = (catalog.releases[idx].tracks || [])[i] || {};
                return Object.assign({}, prev, {
                  providerTrackId: t.providerTrackId,
                  isrc: t.isrc || prev.isrc,
                  title: t.title || prev.title
                });
              })
            : catalog.releases[idx].tracks,
          updatedAt: new Date().toISOString()
        });
        await writeLogical(store, access.workspaceId, 'releaseCatalog', catalog);

        const registryRec = await readLogical(store, access.workspaceId, 'trackRegistry');
        const nextRegistry = mergeTrackRegistry(
          registryRec.value,
          catalog.releases[idx].tracks || [],
          catalog.releases[idx].status
        );
        await writeLogical(store, access.workspaceId, 'trackRegistry', nextRegistry);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: status, release: idx > -1 ? catalog.releases[idx] : null })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Unknown action' }) };
  } catch (error) {
    return {
      statusCode: error.status || 500,
      headers,
      body: JSON.stringify({
        message: error.message || 'distro request failed',
        details: error.details || null
      })
    };
  }
};
