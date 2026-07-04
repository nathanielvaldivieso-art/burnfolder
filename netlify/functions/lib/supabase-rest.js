'use strict';

function supabaseConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function serviceHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };
}

async function verifyUserJwt(token) {
  if (!token || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return null;
  }
  const res = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + token
    }
  });
  if (!res.ok) return null;
  return res.json();
}

async function restGet(path, query) {
  const url = new URL(process.env.SUPABASE_URL + '/rest/v1/' + path);
  if (query) {
    Object.keys(query).forEach(function (key) {
      url.searchParams.set(key, query[key]);
    });
  }
  const res = await fetch(url.toString(), { headers: serviceHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Supabase GET ' + path + ' failed: ' + res.status + ' ' + text);
  }
  return res.json();
}

async function restPost(path, body, prefer) {
  const headers = serviceHeaders();
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(process.env.SUPABASE_URL + '/rest/v1/' + path, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Supabase POST ' + path + ' failed: ' + res.status + ' ' + text);
  }
  if (prefer && prefer.indexOf('return=representation') > -1) {
    return res.json();
  }
  return null;
}

async function restPatch(path, query, body) {
  const url = new URL(process.env.SUPABASE_URL + '/rest/v1/' + path);
  if (query) {
    Object.keys(query).forEach(function (key) {
      url.searchParams.set(key, query[key]);
    });
  }
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: Object.assign({}, serviceHeaders(), { Prefer: 'return=representation' }),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Supabase PATCH failed: ' + res.status + ' ' + text);
  }
  return res.json();
}

async function restDelete(path, query) {
  const url = new URL(process.env.SUPABASE_URL + '/rest/v1/' + path);
  if (query) {
    Object.keys(query).forEach(function (key) {
      url.searchParams.set(key, query[key]);
    });
  }
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: serviceHeaders()
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Supabase DELETE failed: ' + res.status + ' ' + text);
  }
}

module.exports = {
  supabaseConfigured,
  verifyUserJwt,
  restGet,
  restPost,
  restPatch,
  restDelete
};
