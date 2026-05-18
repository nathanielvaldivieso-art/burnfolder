const { connectLambda, getStore } = require('@netlify/blobs');

const STORE_NAME = 'burnfolder-newsletter';
const LIST_KEY = 'subscriber-emails';

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!process.env.SUBSCRIBERS_EXPORT_SECRET || token !== process.env.SUBSCRIBERS_EXPORT_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ message: 'Unauthorized' }) };
  }

  try {
    connectLambda(event);
    const store = getStore(STORE_NAME);
    const list = await store.get(LIST_KEY, { type: 'json' });
    const subscribers = Array.isArray(list) ? list : [];
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ subscribers }),
    };
  } catch (error) {
    console.error('export-subscribers:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ message: error.message }) };
  }
};
