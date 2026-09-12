import { Request, Response } from 'express';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { pool } from './db';

// Verified against Meta Business Login / Get Started documentation, 2026-09-11.
export const REDIRECT_URI = 'https://vivid-novel-ai-production.up.railway.app/auth/instagram/callback';
export const SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages'];
const COOKIE = '__Secure-vn_ig_oauth';
const COOKIE_PATH = '/auth/instagram/callback';
const TTL = 10 * 60 * 1000;
const DAY = 86400000;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const adminHash = () => hash(process.env.ADMIN_TOKEN || '');
function encryptionKey() {
 const value = process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY || '';
 if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('configuration');
 const key = Buffer.from(value, 'base64');
 if (key.length !== 32) throw new Error('configuration');
 return key;
}
export function missingConfiguration() {
 const missing: string[] = [];
 if (!/^\d+$/.test(process.env.INSTAGRAM_APP_ID || '')) missing.push('INSTAGRAM_APP_ID');
 if (!process.env.INSTAGRAM_APP_SECRET?.trim()) missing.push('INSTAGRAM_APP_SECRET');
 try { encryptionKey(); } catch { missing.push('INSTAGRAM_TOKEN_ENCRYPTION_KEY'); }
 return missing;
}
export function encryptToken(token: string) {
 const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
 cipher.setAAD(Buffer.from('vivid-novel:instagram:v1'));
 const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
 return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}
export function decryptToken(value: string) {
 const [version, iv, tag, encrypted, extra] = value.split('.');
 if (version !== 'v1' || !iv || !tag || !encrypted || extra) throw new Error('storage');
 const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
 decipher.setAAD(Buffer.from('vivid-novel:instagram:v1'));
 decipher.setAuthTag(Buffer.from(tag, 'base64'));
 return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}
// Never propagate Meta bodies, URLs, tokens or exceptions to pages or logs.
async function meta(url: string, init: RequestInit = {}) {
 const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
 if (!response.ok) throw new Error('meta');
 const data = await response.json() as any;
 if (!data || data.error || data.error_type) throw new Error('meta');
 return data;
}
function one(data: any) {
 if (Array.isArray(data?.data)) {
  if (data.data.length !== 1) throw new Error('response');
  return data.data[0];
 }
 return data;
}
function tokenResult(data: any) {
 if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 16384 ||
     data.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(data.expires_in) ||
     data.expires_in <= 0 || data.expires_in > 60 * 86400) throw new Error('response');
 return { token: data.access_token as string, seconds: data.expires_in as number };
}
function privateHeaders(res: Response) {
 res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
}
function resultPage(res: Response, status: number, message: string) {
 return res.status(status).type('html').send('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Instagram connection</title></head><body><h1>Instagram connection</h1><p>' + message + '</p><p>Emily Auto-Replies remain PAUSED. No messages were sent.</p><a href="/admin/">Return to the studio</a></body></html>');
}
export async function connectInstagram(_req: Request, res: Response) {
 try {
  const missing = missingConfiguration();
  if (missing.length) { res.status(503).json({ error: 'Complete the Instagram variables in Railway first.', missingVariables: missing }); return; }
  const state = randomBytes(32).toString('hex'), browser = randomBytes(32).toString('hex');
  await pool.query('DELETE FROM vn_instagram_oauth_states WHERE expires_at <= now()');
  await pool.query('INSERT INTO vn_instagram_oauth_states(state_hash,browser_hash,admin_hash,expires_at) VALUES($1,$2,$3,$4)',
   [hash(state), hash(browser), adminHash(), new Date(Date.now() + TTL)]);
  res.cookie(COOKIE, browser, { secure: true, httpOnly: true, sameSite: 'lax', path: COOKIE_PATH, maxAge: TTL });
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.search = new URLSearchParams({ client_id: process.env.INSTAGRAM_APP_ID!, redirect_uri: REDIRECT_URI,
   response_type: 'code', scope: SCOPES.join(','), state }).toString();
  res.json({ authorizationUrl: url.toString() });
 } catch { res.status(503).json({ error: 'Instagram connection setup is unavailable. Please retry.' }); }
}
export async function instagramCallback(req: Request, res: Response) {
 privateHeaders(res);
 const state = req.query.state;
 const cookies = (req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith(COOKIE + '='));
 const browser = cookies.length === 1 ? cookies[0].slice(COOKIE.length + 1) : '';
 if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(browser)) {
  resultPage(res, 400, 'Invalid or expired authorization state. Start again from Connect Instagram in the studio.'); return;
 }
 try {
  // Atomic delete provides single use across processes and concurrent callbacks.
  const consumed = await pool.query('DELETE FROM vn_instagram_oauth_states WHERE state_hash=$1 AND browser_hash=$2 AND admin_hash=$3 AND expires_at>now() RETURNING state_hash',
   [hash(state), hash(browser), adminHash()]);
  res.clearCookie(COOKIE, { secure: true, httpOnly: true, sameSite: 'lax', path: COOKIE_PATH });
  if (!consumed.rowCount) { resultPage(res, 400, 'Invalid or expired authorization state. Start again from Connect Instagram in the studio.'); return; }
  if (['error', 'error_reason', 'error_description'].some(k => Object.hasOwn(req.query, k))) {
   resultPage(res, 400, 'Instagram authorization was declined or interrupted. Reconnect from the studio when ready.'); return;
  }
  const code = req.query.code;
  if (typeof code !== 'string' || !code.trim() || code.length > 8192) {
   resultPage(res, 400, 'Instagram did not return a valid authorization code. Start again from the studio.'); return;
  }
  if (missingConfiguration().length) { resultPage(res, 503, 'Instagram configuration is incomplete. Check the studio connection status.'); return; }
  const body = new FormData();
  for (const [k, v] of Object.entries({ client_id: process.env.INSTAGRAM_APP_ID!, client_secret: process.env.INSTAGRAM_APP_SECRET!,
   grant_type: 'authorization_code', redirect_uri: REDIRECT_URI, code: code.replace(/#_$/, '') })) body.set(k, v);
  const short = one(await meta('https://api.instagram.com/oauth/access_token', { method: 'POST', body }));
  const permissions = typeof short.permissions === 'string' ? short.permissions.split(',').map((s: string) => s.trim()) : short.permissions;
  if (typeof short.access_token !== 'string' || !short.access_token || !/^\d+$/.test(String(short.user_id || '')) ||
      !Array.isArray(permissions) || !SCOPES.every(p => permissions.includes(p))) throw new Error('permissions');
  const exchange = new URL('https://graph.instagram.com/access_token');
  exchange.search = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: process.env.INSTAGRAM_APP_SECRET!, access_token: short.access_token }).toString();
  const long = tokenResult(await meta(exchange.toString()));
  const identityUrl = new URL('https://graph.instagram.com/v26.0/me');
  identityUrl.search = new URLSearchParams({ fields: 'id,user_id,username,account_type', access_token: long.token }).toString();
  const identity = one(await meta(identityUrl.toString()));
  if (String(identity.id) !== String(short.user_id) || !/^\d+$/.test(String(identity.user_id || '')) ||
      typeof identity.username !== 'string' || identity.username.toLowerCase() !== 'vivid.novel' ||
      !['business', 'media_creator'].includes(String(identity.account_type).toLowerCase())) {
   resultPage(res, 400, 'The verified professional account did not match @vivid.novel. No connection was saved. Reconnect with the correct account.'); return;
  }
  const saved = await pool.query(`INSERT INTO vn_instagram_connection(singleton,app_scoped_id,instagram_user_id,username,account_type,token_ciphertext,permissions,issued_at,expires_at)
   VALUES(true,$1,$2,$3,$4,$5,$6,now(),$7)
   ON CONFLICT(singleton) DO UPDATE SET token_ciphertext=excluded.token_ciphertext,permissions=excluded.permissions,
    username=excluded.username,account_type=excluded.account_type,issued_at=excluded.issued_at,expires_at=excluded.expires_at,connected_at=now(),refresh_status='ok'
   WHERE vn_instagram_connection.instagram_user_id=excluded.instagram_user_id AND vn_instagram_connection.app_scoped_id=excluded.app_scoped_id
   RETURNING singleton`,
   [String(identity.id), String(identity.user_id), identity.username, identity.account_type, encryptToken(long.token), SCOPES, new Date(Date.now() + long.seconds * 1000)]);
  if (!saved.rowCount) { resultPage(res, 409, 'This account differs from the existing connection. The existing connection was preserved.'); return; }
  resultPage(res, 200, 'Instagram authorization succeeded and the verified @vivid.novel connection was securely saved.');
 } catch { resultPage(res, 502, 'Instagram connection could not be completed. The previous connection, if any, was preserved. Start a fresh connection from the studio.'); }
}
export async function instagramStatus(_req: Request, res: Response) {
 try {
  const { rows } = await pool.query('SELECT instagram_user_id,username,account_type,expires_at,connected_at,refresh_status FROM vn_instagram_connection WHERE singleton=true');
  const row = rows[0], expired = row && new Date(row.expires_at).getTime() <= Date.now();
  res.json({ status: !row ? 'not_connected' : expired ? 'expired' : row.refresh_status === 'ok' ? 'connected' : 'refresh_failed',
   missingVariables: missingConfiguration(), account: row ? { id: row.instagram_user_id, username: row.username, type: row.account_type } : null,
   expiresAt: row?.expires_at || null, connectedAt: row?.connected_at || null, autoRepliesEnabled: false });
 } catch { res.status(503).json({ error: 'Instagram connection status is unavailable.' }); }
}
// Refresh only unexpired tokens older than 24h, when fewer than 7 days remain.
// A transaction lock and conditional update serialize refresh with reconnect.
export async function refreshInstagramToken() {
 if (missingConfiguration().length) return;
 const db = await pool.connect();
 try {
  await db.query('BEGIN');
  const lock = await db.query('SELECT pg_try_advisory_xact_lock(86162027) AS locked');
  if (!lock.rows[0].locked) { await db.query('ROLLBACK'); return; }
  const { rows } = await db.query('SELECT * FROM vn_instagram_connection WHERE singleton=true FOR UPDATE');
  const row = rows[0], now = Date.now();
  if (row && new Date(row.issued_at).getTime() <= now - DAY && new Date(row.expires_at).getTime() > now &&
      new Date(row.expires_at).getTime() <= now + 7 * DAY && row.permissions.includes(SCOPES[0])) {
   try {
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: decryptToken(row.token_ciphertext) }).toString();
    const refreshed = tokenResult(await meta(url.toString()));
    await db.query("UPDATE vn_instagram_connection SET token_ciphertext=$1,issued_at=now(),expires_at=$2,refresh_status='ok' WHERE singleton=true",
     [encryptToken(refreshed.token), new Date(Date.now() + refreshed.seconds * 1000)]);
   } catch { await db.query("UPDATE vn_instagram_connection SET refresh_status='failed' WHERE singleton=true"); }
  }
  await db.query('COMMIT');
 } catch { await db.query('ROLLBACK'); } finally { db.release(); }
}
export function startInstagramRefresh() {
 const run = () => { void refreshInstagramToken().catch(() => { /* no private exception logging */ }); };
 run();
 setInterval(run, 6 * 60 * 60 * 1000).unref();
}
