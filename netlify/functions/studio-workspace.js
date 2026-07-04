'use strict';

const {
  studioCorsHeaders,
  requireWorkspaceAccess
} = require('./lib/workspace-auth');
const { supabaseConfigured } = require('./lib/supabase-rest');

function corsHeaders() {
  return studioCorsHeaders('GET, OPTIONS');
}

function projectList(access) {
  if (!access.projects) return [];
  return Object.keys(access.projects).map(function (projectId) {
    return {
      projectId: projectId,
      role: access.projects[projectId]
    };
  });
}

exports.handler = async function (event) {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  if (!supabaseConfigured()) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ message: 'Workspace API requires Supabase configuration' })
    };
  }

  const access = await requireWorkspaceAccess(event, { requireWrite: false });
  if (!access.ok) {
    return { statusCode: access.statusCode, headers, body: JSON.stringify(access.body) };
  }

  try {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        workspace: {
          id: access.workspaceId,
          slug: access.slug,
          name: access.name,
          role: access.role,
          accessMode: access.accessMode || 'owner'
        },
        projects: projectList(access)
      })
    };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: error.message || 'read failed' }) };
  }
};
