// Receipt photos and PDFs. In production they go to a private Supabase Storage bucket
// (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY); otherwise they are files in DATA_DIR/uploads.
// Either way they are only ever served through the app, after its own permission check.
const fs = require('fs/promises');
const path = require('path');
const { UPLOAD_DIR } = require('./db');

const BUCKET = process.env.SUPABASE_BUCKET || 'receipts';
const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = {
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.heic': 'image/heic', '.heif': 'image/heif', '.pdf': 'application/pdf', '.svg': 'image/svg+xml',
};
const contentType = (name) => TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream';
const safeName = (name) => path.basename(String(name));

const supabase = () => (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? { url: process.env.SUPABASE_URL.replace(/\/+$/, ''), key: process.env.SUPABASE_SERVICE_ROLE_KEY } : null);

function headers(key, extra = {}) {
  // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys only go in apikey.
  return { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), ...extra };
}

let bucketReady = null;
function ensureBucket(sb) {
  bucketReady ||= (async () => {
    const res = await fetch(`${sb.url}/storage/v1/bucket`, {
      method: 'POST',
      headers: headers(sb.key, { 'content-type': 'application/json' }),
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: MAX_BYTES, allowed_mime_types: Object.values(TYPES) }),
    });
    if (!res.ok && res.status !== 409 && !/exist/i.test(await res.text())) throw new Error(`Could not create the ${BUCKET} storage bucket (HTTP ${res.status}).`);
  })().catch((err) => { bucketReady = null; throw err; });
  return bucketReady;
}

async function save(name, buffer) {
  const file = safeName(name);
  const sb = supabase();
  if (!sb) {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR, file), buffer, { flag: 'wx' });
    return;
  }
  await ensureBucket(sb);
  const res = await fetch(`${sb.url}/storage/v1/object/${BUCKET}/${encodeURIComponent(file)}`, {
    method: 'POST', headers: headers(sb.key, { 'content-type': contentType(file), 'x-upsert': 'false' }), body: buffer,
  });
  if (!res.ok) throw new Error(`Receipt upload failed (HTTP ${res.status}).`);
}

// Returns { body, type } or null when the file isn't there.
async function read(name) {
  const file = safeName(name);
  const sb = supabase();
  if (!sb) {
    try { return { body: await fs.readFile(path.join(UPLOAD_DIR, file)), type: contentType(file) }; } catch { return null; }
  }
  const res = await fetch(`${sb.url}/storage/v1/object/authenticated/${BUCKET}/${encodeURIComponent(file)}`, { headers: headers(sb.key) });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not fetch the receipt (HTTP ${res.status}).`);
  return { body: Buffer.from(await res.arrayBuffer()), type: contentType(file) };
}

async function remove(name) {
  const file = safeName(name);
  const sb = supabase();
  if (!sb) return fs.rm(path.join(UPLOAD_DIR, file), { force: true });
  await fetch(`${sb.url}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE', headers: headers(sb.key, { 'content-type': 'application/json' }), body: JSON.stringify({ prefixes: [file] }),
  });
}

module.exports = { save, read, remove, contentType, where: () => (supabase() ? `Supabase Storage (${BUCKET})` : UPLOAD_DIR) };
