'use strict';

const { requireStudioAccess, studioCorsHeaders } = require('./studio-auth');
const { supabaseConfigured, verifyUserJwt, restGet, restPost } = require('./supabase-rest');

const LOGICAL_KEY_PATTERN = /^[a-z][a-zA-Z0-9_-]{0,48}$/;
const PROJECT_ID_PATTERN = /^g_[a-z0-9_]+$/i;
const MUSIC_PROJECT_KEYS = ['groups'];
const OWNER_ONLY_KEYS = [
  'drafts',
  'stack',
  'stackMeta',
  'journalDays',
  'songPages',
  'albumPages',
  'releaseDates',
  'trackPipeline',
  'pendingStack'
];

function scopedBlobKey(workspaceId, logicalKey) {
  if (!LOGICAL_KEY_PATTERN.test(logicalKey)) return null;
  if (!workspaceId || workspaceId === 'legacy') return logicalKey;
  return 'ws_' + String(workspaceId).replace(/-/g, '') + '_' + logicalKey;
}

function legacyBlobKey(logicalKey) {
  return logicalKey;
}

function canPublish(role) {
  return role === 'owner';
}

function bearerToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

function workspaceHeader(event) {
  return (
    event.headers['x-workspace-id'] ||
    event.headers['X-Workspace-Id'] ||
    ''
  ).trim();
}

function normalizeProjectAccess(rows) {
  const projects = {};
  (rows || []).forEach(function (row) {
    projects[row.project_id] = row.role === 'guest' ? 'guest' : 'collaborator';
  });
  return projects;
}

function accessFromOwner(membership) {
  return {
    workspaceId: membership.workspaceId,
    slug: membership.slug,
    name: membership.name,
    role: 'owner',
    accessMode: 'owner',
    isOwner: true,
    projects: null
  };
}

function accessFromProjects(workspace, projectsMap) {
  const projectIds = Object.keys(projectsMap);
  const hasWrite = projectIds.some(function (id) {
    return projectsMap[id] === 'collaborator';
  });
  return {
    workspaceId: workspace.id,
    slug: workspace.slug || '',
    name: workspace.name || '',
    role: hasWrite ? 'music-collaborator' : 'music-guest',
    accessMode: 'music-project',
    isOwner: false,
    projects: projectsMap
  };
}

async function loadProjectMemberships(userId, workspaceId) {
  const query = {
    select: 'workspace_id,project_id,role',
    user_id: 'eq.' + userId
  };
  if (workspaceId) query.workspace_id = 'eq.' + workspaceId;
  const rows = await restGet('music_project_members', query);
  return Array.isArray(rows) ? rows : [];
}

async function loadWorkspaceById(workspaceId) {
  const rows = await restGet('workspaces', {
    select: 'id,slug,name',
    id: 'eq.' + workspaceId
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function ensureDefaultWorkspace(userId) {
  const members = await restGet('workspace_members', {
    select: 'role,workspace_id,workspaces(slug,name)',
    user_id: 'eq.' + userId
  });
  const ownerRow = Array.isArray(members)
    ? members.find(function (row) {
        return row.role === 'owner';
      })
    : null;
  if (ownerRow) {
    const ws = ownerRow.workspaces || {};
    return {
      workspaceId: ownerRow.workspace_id,
      slug: ws.slug || '',
      name: ws.name || '',
      role: 'owner'
    };
  }

  const slug = 'burnfolder';
  const name = 'burnfolder';
  let workspace;
  try {
    const created = await restPost(
      'workspaces',
      { slug: slug, name: name, owner_user_id: userId },
      'return=representation'
    );
    workspace = Array.isArray(created) ? created[0] : created;
  } catch (error) {
    const existing = await restGet('workspaces', {
      select: 'id,slug,name',
      slug: 'eq.' + slug
    });
    workspace = Array.isArray(existing) ? existing[0] : null;
    if (!workspace) throw error;
  }

  const memberRows = await restGet('workspace_members', {
    select: 'role',
    workspace_id: 'eq.' + workspace.id,
    user_id: 'eq.' + userId
  });
  if (!Array.isArray(memberRows) || !memberRows.length) {
    await restPost('workspace_members', {
      workspace_id: workspace.id,
      user_id: userId,
      role: 'owner'
    });
  }

  return {
    workspaceId: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    role: 'owner'
  };
}

async function resolveMembership(userId, workspaceId) {
  const rows = await restGet('workspace_members', {
    select: 'role,workspace_id,workspaces(id,slug,name)',
    user_id: 'eq.' + userId,
    workspace_id: 'eq.' + workspaceId
  });
  if (!Array.isArray(rows) || !rows.length) return null;
  const row = rows[0];
  const ws = row.workspaces || {};
  return {
    workspaceId: row.workspace_id,
    slug: ws.slug || '',
    name: ws.name || '',
    role: row.role
  };
}

async function resolveUserAccess(userId, workspaceIdHint) {
  if (workspaceIdHint) {
    const membership = await resolveMembership(userId, workspaceIdHint);
    if (membership && membership.role === 'owner') {
      return accessFromOwner(membership);
    }
    const projectRows = await loadProjectMemberships(userId, workspaceIdHint);
    if (projectRows.length) {
      const workspace = await loadWorkspaceById(workspaceIdHint);
      if (workspace) {
        return accessFromProjects(workspace, normalizeProjectAccess(projectRows));
      }
    }
    return null;
  }

  const members = await restGet('workspace_members', {
    select: 'role,workspace_id,workspaces(slug,name)',
    user_id: 'eq.' + userId
  });
  const ownerRow = Array.isArray(members)
    ? members.find(function (row) {
        return row.role === 'owner';
      })
    : null;
  if (ownerRow) {
    const ws = ownerRow.workspaces || {};
    return accessFromOwner({
      workspaceId: ownerRow.workspace_id,
      slug: ws.slug || '',
      name: ws.name || '',
      role: 'owner'
    });
  }

  const projectRows = await loadProjectMemberships(userId);
  if (projectRows.length) {
    const workspace = await loadWorkspaceById(projectRows[0].workspace_id);
    if (workspace) {
      const scoped = projectRows.filter(function (row) {
        return row.workspace_id === workspace.id;
      });
      return accessFromProjects(workspace, normalizeProjectAccess(scoped));
    }
  }

  const created = await ensureDefaultWorkspace(userId);
  return accessFromOwner(created);
}

function canWriteStudioState(access) {
  if (!access) return false;
  if (access.isOwner) return true;
  if (access.accessMode === 'music-project') {
    return access.role === 'music-collaborator';
  }
  return false;
}

function canAccessStateKey(access, logicalKey) {
  if (!access) return false;
  if (access.isOwner) return true;
  return MUSIC_PROJECT_KEYS.indexOf(logicalKey) > -1;
}

function canWriteProject(access, projectId) {
  if (!access || !projectId) return false;
  if (access.isOwner) return true;
  return access.projects && access.projects[projectId] === 'collaborator';
}

function canReadProject(access, projectId) {
  if (!access || !projectId) return false;
  if (access.isOwner) return true;
  return access.projects && Object.prototype.hasOwnProperty.call(access.projects, projectId);
}

function filterGroupsForAccess(groups, access) {
  if (!Array.isArray(groups)) return [];
  if (!access || access.isOwner) return groups;
  return groups.filter(function (group) {
    return group && canReadProject(access, group.id);
  });
}

function mergeGroupsForAccess(fullGroups, nextGroups, access) {
  const current = Array.isArray(fullGroups) ? fullGroups.slice() : [];
  const incoming = Array.isArray(nextGroups) ? nextGroups : [];
  if (!access || access.isOwner) return incoming;

  const allowedIds = incoming
    .map(function (group) {
      return group && group.id;
    })
    .filter(function (id) {
      return id && canWriteProject(access, id);
    });

  if (!allowedIds.length && incoming.length) {
    throw new Error('No access to these projects');
  }

  incoming.forEach(function (group) {
    if (!group || !group.id) return;
    if (!canWriteProject(access, group.id)) {
      throw new Error('No write access to project ' + group.id);
    }
    const index = current.findIndex(function (row) {
      return row && row.id === group.id;
    });
    if (index > -1) current[index] = group;
    else current.push(group);
  });

  return current;
}

async function requireWorkspaceAccess(event, options) {
  const opts = options || {};
  const needPublish = opts.requirePublish === true;
  const logicalKey = opts.logicalKey || '';

  if (!supabaseConfigured()) {
    const legacy = requireStudioAccess(event);
    if (!legacy.ok) return legacy;
    return {
      ok: true,
      legacy: true,
      workspaceId: 'legacy',
      userId: null,
      role: 'owner',
      accessMode: 'owner',
      isOwner: true,
      projects: null,
      email: null
    };
  }

  const token = bearerToken(event);
  if (!token) {
    return { ok: false, statusCode: 401, body: { message: 'Unauthorized' } };
  }

  const user = await verifyUserJwt(token);
  if (!user || !user.id) {
    return { ok: false, statusCode: 401, body: { message: 'Invalid session' } };
  }

  const access = await resolveUserAccess(user.id, workspaceHeader(event) || null);
  if (!access) {
    return { ok: false, statusCode: 403, body: { message: 'No studio access' } };
  }

  if (needPublish && !canPublish(access.role)) {
    return { ok: false, statusCode: 403, body: { message: 'Owner role required' } };
  }

  if (logicalKey && !canAccessStateKey(access, logicalKey)) {
    return { ok: false, statusCode: 403, body: { message: 'Access denied for this data' } };
  }

  if (event.httpMethod === 'POST' && opts.requireWrite !== false) {
    if (!canWriteStudioState(access)) {
      return { ok: false, statusCode: 403, body: { message: 'Read-only access' } };
    }
  }

  return Object.assign(
    {
      ok: true,
      legacy: false,
      userId: user.id,
      email: user.email || null
    },
    access
  );
}

module.exports = {
  studioCorsHeaders,
  requireWorkspaceAccess,
  resolveUserAccess,
  scopedBlobKey,
  legacyBlobKey,
  LOGICAL_KEY_PATTERN,
  PROJECT_ID_PATTERN,
  OWNER_ONLY_KEYS,
  canPublish,
  canWriteStudioState,
  canAccessStateKey,
  canWriteProject,
  canReadProject,
  filterGroupsForAccess,
  mergeGroupsForAccess
};
