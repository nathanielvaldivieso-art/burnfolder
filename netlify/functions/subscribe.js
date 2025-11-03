const { Octokit } = require("@octokit/rest");

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Method Not Allowed' })
    };
  }

  try {
    const { email } = JSON.parse(event.body);
    
    // Validate email
    if (!email || !email.includes('@')) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid email' })
      };
    }

    // Initialize GitHub API client
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });

    const owner = 'nathanielvaldivieso-art';
    const repo = 'burnfolder';
    const path = 'subscribers.json';
    
    // Get current subscribers.json file
    const { data: fileData } = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    // Decode and parse current content
    const content = Buffer.from(fileData.content, 'base64').toString('utf8');
    const subscribers = JSON.parse(content);

    // Check if email already exists
    if (subscribers.subscribers.includes(email)) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Already subscribed' })
      };
    }

    // Add new subscriber
    subscribers.subscribers.push(email);

    // Update file on GitHub
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `Add subscriber: ${email}`,
      content: Buffer.from(JSON.stringify(subscribers, null, 2)).toString('base64'),
      sha: fileData.sha,
    });

    // Trigger welcome email workflow
    await octokit.repos.createDispatchEvent({
      owner,
      repo,
      event_type: 'send_welcome_email',
      client_payload: {
        email: email
      }
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ message: 'Subscribed successfully' })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Server error', error: error.message })
    };
  }
};
