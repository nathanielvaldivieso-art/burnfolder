'use strict';

const { studioCorsHeaders } = require('./lib/workspace-auth');

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

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      supabaseUrl: supabaseUrl,
      supabaseAnonKey: supabaseAnonKey,
      authMode: supabaseUrl && supabaseAnonKey ? 'supabase' : 'legacy'
    })
  };
};
