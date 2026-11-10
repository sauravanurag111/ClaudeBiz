import crypto from 'node:crypto';
import { one } from './db.js';

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET not set: using a random one, so logins reset on every restart.');
}
const COOKIE = 'df_session';
const MAX_AGE_S = 60 * 60 * 24 * 30;

export function randomId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setSession(res, userId) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const payload = `${userId}.${exp}`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function loadUser(req, _res, next) {
  try {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    if (raw) {
      const [id, exp, sig] = raw.split('.');
      const payload = `${id}.${exp}`;
      const expected = sign(payload);
      if (sig && sig.length === expected.length
        && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
        && Number(exp) > Date.now() / 1000) {
        req.user = await one('SELECT * FROM users WHERE id = $1', [Number(id)]);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

export async function createUser({ email, password, name, businessName }) {
  return one(
    `INSERT INTO users (email, name, password_hash, mcp_key, business_name)
     VALUES (lower($1), $2, $3, $4, $5) RETURNING *`,
    [email.trim(), name || '', hashPassword(password), randomId(18), businessName || name || ''],
  );
}

/** Make sure the reviewer test account exists (credentials come from env). */
export async function ensureDemoUser() {
  const email = process.env.DEMO_EMAIL;
  const password = process.env.DEMO_PASSWORD;
  if (!email || !password) return;
  const existing = await one('SELECT id FROM users WHERE email = lower($1)', [email]);
  const fixedKey = process.env.DEMO_MCP_KEY;
  if (existing) {
    await one('UPDATE users SET password_hash = $2, mcp_key = COALESCE($3, mcp_key) WHERE id = $1 RETURNING id',
      [existing.id, hashPassword(password), fixedKey || null]);
    // One-time rename of the original demo identity; later edits in Settings are kept.
    await one(
      `UPDATE users SET name = 'Anurag', business_name = 'Meesho', business_address = 'Bengaluru, India',
         payment_instructions = 'UPI: anurag@upi (sample details for the demo account)'
       WHERE id = $1 AND name = 'Demo Studio' RETURNING id`, [existing.id]);
    return;
  }
  const user = await createUser({ email, password, name: 'Anurag', businessName: 'Meesho' });
  if (fixedKey) await one('UPDATE users SET mcp_key = $2 WHERE id = $1 RETURNING id', [user.id, fixedKey]);
  await one(
    `UPDATE users SET business_address = $2, payment_instructions = $3 WHERE id = $1 RETURNING id`,
    [user.id, 'Bengaluru, India', 'UPI: anurag@upi (sample details for the demo account)'],
  );
  console.log(`Created demo account ${email}`);
}

export const isDemoUser = (user) => !!process.env.DEMO_EMAIL && user?.email === process.env.DEMO_EMAIL.toLowerCase();
