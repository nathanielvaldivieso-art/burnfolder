'use strict';

const { studioCorsHeaders } = require('./lib/workspace-auth');
const { isLocalDevelopment } = require('./lib/studio-auth');

function supabaseReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(function () {
    controller.abort();
  }, 4000);
  return fetch(url + '/auth/v1/health', { signal: controller.signal })
    .then(function (res) {
      return res.ok || res.status === 404;
    })
    .catch(function () {
      return false;
    })
    .finally(function () {
      clearTimeout(timer);
    });
}

exports.handler = async function (event) {
  const headers = studioCorsHeaders('GET, OPTIONS');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

  let authMode = 'open';
  if (supabaseUrl && supabaseAnonKey) {
    authMode = (await supabaseReachable(supabaseUrl)) ? 'supabase' : 'open';
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      supabaseUrl: supabaseUrl,
      supabaseAnonKey: supabaseAnonKey,
      authMode: authMode,
      devBypass: isLocalDevelopment()
    })
  };
};
