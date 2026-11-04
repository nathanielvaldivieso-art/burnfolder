'use strict';

const TO_EMAIL = process.env.OFFERS_TO_EMAIL || 'nathaniel@burnfolder.com';

// Same providers as the studio mailers: Resend if configured, else SendGrid.
async function sendOfferEmail(subject, text, replyTo) {
  const from = process.env.NEWSLETTER_FROM || 'burnfolder <nathaniel@burnfolder.com>';
  const resendKey = process.env.RESEND_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (!resendKey && !sendgridKey) {
    throw new Error('email not configured');
  }

  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [TO_EMAIL], reply_to: replyTo || undefined, subject, text })
    });
    if (!res.ok) throw new Error('resend failed: ' + ((await res.text()) || res.status));
    return;
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + sendgridKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: TO_EMAIL }] }],
      from: { email: 'nathaniel@burnfolder.com', name: 'burnfolder' },
      reply_to: replyTo ? { email: replyTo } : undefined,
      subject,
      content: [{ type: 'text/plain', value: text }]
    })
  });
  if (!res.ok) throw new Error('sendgrid failed: ' + ((await res.text()) || res.status));
}

function offerText({ name, email, amount, pitch, links }) {
  return [name || '', email || '', amount ? `$${amount}` : null, '', 'pitch', pitch || '', '', 'links', links || '-']
    .filter((line) => line !== null)
    .join('\n');
}

module.exports = { sendOfferEmail, offerText };
