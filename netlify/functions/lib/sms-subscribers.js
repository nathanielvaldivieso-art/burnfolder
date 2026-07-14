const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'burnfolder-newsletter';
const PHONES_KEY = 'subscriber-phones';

function getNewsletterStore() {
  return getStore(STORE_NAME);
}

/** Digits only; US default when 10 digits. Returns E.164 or null. */
function normalizePhone(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return null;
}

async function readPhones(store) {
  const data = await store.get(PHONES_KEY, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

async function writePhones(store, phones) {
  await store.setJSON(PHONES_KEY, phones);
}

/**
 * Add phone if new. Returns { phones, alreadySubscribed, phone }.
 * phone is normalized E.164.
 */
async function addPhone(store, rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { phone: null, alreadySubscribed: false, phones: await readPhones(store) };
  }

  let phones = await readPhones(store);

  if (phones.length === 0 && process.env.SUBSCRIBER_SEED_PHONES) {
    const seeded = process.env.SUBSCRIBER_SEED_PHONES.split(/[,;\s]+/)
      .map((s) => normalizePhone(s))
      .filter(Boolean);
    if (seeded.length) {
      phones = [...new Set(seeded)];
      await writePhones(store, phones);
    }
  }

  const alreadySubscribed = phones.some((p) => normalizePhone(p) === phone);
  if (!alreadySubscribed) {
    phones.push(phone);
    await writePhones(store, phones);
  }

  return { phone, alreadySubscribed, phones };
}

async function removePhone(store, rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { phone: null, removed: false, phones: await readPhones(store) };

  const phones = await readPhones(store);
  const next = phones.filter((p) => normalizePhone(p) !== phone);
  const removed = next.length !== phones.length;
  if (removed) await writePhones(store, next);
  return { phone, removed, phones: next };
}

module.exports = {
  STORE_NAME,
  PHONES_KEY,
  getNewsletterStore,
  normalizePhone,
  readPhones,
  writePhones,
  addPhone,
  removePhone,
};
