'use strict';

const crypto = require('crypto');
const {
  studioCorsHeaders,
  requireWorkspaceAccess,
  canPublish,
  PROJECT_ID_PATTERN
} = require('./lib/workspace-auth');
const { supabaseConfigured, restGet, restPost, restPatch, restDelete } = require('./lib/supabase-rest');

function corsHeaders() {
  return studioCorsHeaders('GET, POST, OPTIONS');
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function inviteUrl(event, token) {
  const host = event.headers.host || event.headers.Host || 'burnfolder.com';
  let proto = (event.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (!proto) {
    proto = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? 'http' : 'https';
  }
  return proto + '://' + host + '/studio/invite.html?t=' + encodeURIComponent(token);
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (!supabaseConfigured()) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ message: 'Music project API requires Supabase configuration' })
    };
  }

  const access = await requireWorkspaceAccess(event, { requireWrite: false });
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  const projectId =
    event.httpMethod === 'GET'
      ? ((event.queryStringParameters && event.queryStringParameters.projectId) || '')
      : (function () {
          try {
            const body = JSON.parse(event.body || '{}');
            return typeof body.projectId === 'string' ? body.projectId.trim() : '';
          } catch {
            return '';
          }
        })();

  if (event.httpMethod === 'GET') {
    if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'Valid projectId required' }) };
    }
    if (!canPublish(access.role)) {
      return { statusCode: 403, headers, body: JSON.stringify({ message: 'Owner role required' }) };
    }
    try {
      const members = await restGet('music_project_members', {
        select: 'user_id,role,created_at',
        workspace_id: 'eq.' + access.workspaceId,
        project_id: 'eq.' + projectId
      });
      const invites = await restGet('music_project_invites', {
        select: 'id,email,role,token,expires_at,accepted_at,created_at',
        workspace_id: 'eq.' + access.workspaceId,
        project_id: 'eq.' + projectId,
        accepted_at: 'is.null'
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          projectId: projectId,
          members: members || [],
          invites: (invites || []).map(function (inv) {
            return Object.assign({}, inv, { url: inviteUrl(event, inv.token) });
          })
        })
      };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'read failed' }) };
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid JSON body' }) };
  }

  const action = body.action || '';

  if (action === 'accept-invite') {
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'token required' }) };
    }
    try {
      const rows = await restGet('music_project_invites', {
        select: 'id,workspace_id,project_id,email,role,expires_at,accepted_at',
        token: 'eq.' + token
      });
      const invite = Array.isArray(rows) ? rows[0] : null;
      if (!invite || invite.accepted_at) {
        return { statusCode: 404, headers, body: JSON.stringify({ message: 'Invite not found' }) };
      }
      if (new Date(invite.expires_at).getTime() < Date.now()) {
        return { statusCode: 410, headers, body: JSON.stringify({ message: 'Invite expired' }) };
      }
      const email = (access.email || '').toLowerCase();
      if (email !== String(invite.email || '').toLowerCase()) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ message: 'Sign in with the invited email address' })
        };
      }
      await restPost('music_project_members', {
        workspace_id: invite.workspace_id,
        project_id: invite.project_id,
        user_id: access.userId,
        role: invite.role
      });
      await restPatch(
        'music_project_invites',
        { id: 'eq.' + invite.id },
        { accepted_at: new Date().toISOString() }
      );
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          workspaceId: invite.workspace_id,
          projectId: invite.project_id
        })
      };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'accept failed' }) };
    }
  }

  if (!canPublish(access.role)) {
    return { statusCode: 403, headers, body: JSON.stringify({ message: 'Owner role required' }) };
  }

  const targetProjectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (!targetProjectId || !PROJECT_ID_PATTERN.test(targetProjectId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Valid projectId required' }) };
  }

  if (action === 'invite') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body.role === 'guest' ? 'guest' : 'collaborator';
    if (!email || email.indexOf('@') < 1) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'Valid email required' }) };
    }
    const token = newToken();
    const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const created = await restPost(
        'music_project_invites',
        {
          workspace_id: access.workspaceId,
          project_id: targetProjectId,
          email: email,
          role: role,
          token: token,
          invited_by: access.userId,
          expires_at: expires
        },
        'return=representation'
      );
      const row = Array.isArray(created) ? created[0] : created;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          invite: Object.assign({}, row, { url: inviteUrl(event, token) })
        })
      };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'invite failed' }) };
    }
  }

  if (action === 'revoke-invite') {
    const inviteId = body.inviteId || '';
    if (!inviteId) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'inviteId required' }) };
    }
    try {
      await restDelete('music_project_invites', {
        id: 'eq.' + inviteId,
        workspace_id: 'eq.' + access.workspaceId,
        project_id: 'eq.' + targetProjectId
      });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'revoke failed' }) };
    }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ message: 'Unknown action' }) };
};
