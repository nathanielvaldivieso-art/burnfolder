exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  try {
    const { email } = JSON.parse(event.body);

    if (!email || !email.includes('@')) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid email' }) };
    }

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const owner = 'nathanielvaldivieso-art';
    const repo = 'burnfolder';
    const path = 'subscribers.json';
    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const ghHeaders = {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };

    // Get current subscribers.json
    const getRes = await fetch(apiBase, { headers: ghHeaders });
    if (!getRes.ok) throw new Error(`GitHub GET failed: ${getRes.status}`);
    const fileData = await getRes.json();

    const content = Buffer.from(fileData.content, 'base64').toString('utf8');
    const subscribers = JSON.parse(content);

    if (subscribers.subscribers.includes(email)) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Already subscribed' }) };
    }

    subscribers.subscribers.push(email);

    // Commit updated subscribers.json
    const putRes = await fetch(apiBase, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify({
        message: `Add subscriber: ${email}`,
        content: Buffer.from(JSON.stringify(subscribers, null, 2)).toString('base64'),
        sha: fileData.sha,
      }),
    });
    if (!putRes.ok) throw new Error(`GitHub PUT failed: ${putRes.status}`);

    // Trigger welcome email workflow
    await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        event_type: 'send_welcome_email',
        client_payload: { email },
      }),
    });

    return { statusCode: 200, headers, body: JSON.stringify({ message: 'Subscribed successfully' }) };

  } catch (error) {
    console.error('Subscribe error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Server error', error: error.message }) };
  }
};
