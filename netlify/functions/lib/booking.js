// Stripe's USD per-charge bounds; no other limits on offers.
const MIN_OFFER = 0.5;
const MAX_OFFER = 999999.99;
const PITCH_MAX = 1500;
const LINKS_MAX = 1000;
const PRODUCT_TITLE = 'hours of my time';

function clip(value, max) {
  return String(value || '').trim().slice(0, max);
}

// Stripe metadata values cap at 500 chars, so long text is spread over numbered keys.
function chunkInto(metadata, key, text, size) {
  for (let i = 0; i * size < text.length; i += 1) {
    metadata[`${key}_${i + 1}`] = text.slice(i * size, (i + 1) * size);
  }
}

function parseBooking(body) {
  body = body || {};
  const amountCents = Math.round(Number(body.amount) * 100);
  if (!Number.isFinite(amountCents) || amountCents < Math.round(MIN_OFFER * 100) || amountCents > Math.round(MAX_OFFER * 100)) {
    return { error: 'Enter an offer amount (at least $0.50).' };
  }
  const pitch = clip(body.pitch, PITCH_MAX);
  if (!pitch) {
    return { error: 'Add a pitch.' };
  }
  const links = clip(body.links, LINKS_MAX);
  const name = clip(body.name, 120);
  const email = clip(body.email, 200);
  const amount = (amountCents / 100).toFixed(2).replace(/\.00$/, '');

  const metadata = {
    order_type: 'offer',
    requires_shipping: 'false',
    product_id: 'hours',
    product_title: PRODUCT_TITLE,
    offer_amount: amount,
    customer_name: name,
    customer_email: email
  };
  chunkInto(metadata, 'pitch', pitch, 500);
  chunkInto(metadata, 'links', links, 500);

  return {
    amountCents,
    amount,
    label: `${PRODUCT_TITLE} — offer $${amount}`,
    email,
    metadata
  };
}

// Pitch with no money offered.
function parsePitch(body) {
  body = body || {};
  const pitch = clip(body.pitch, PITCH_MAX);
  if (!pitch) {
    return { error: 'Add a pitch.' };
  }
  const email = clip(body.email, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Enter an email.' };
  }
  return {
    pitch,
    links: clip(body.links, LINKS_MAX),
    name: clip(body.name, 120),
    email
  };
}

module.exports = { MIN_OFFER, MAX_OFFER, PRODUCT_TITLE, parseBooking, parsePitch };
