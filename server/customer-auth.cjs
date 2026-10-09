'use strict';
const crypto = require('node:crypto');
const ORIGIN = 'https://www.wearmudra.shop';
const ACCOUNT = 'https://account.wearmudra.shop';
const CLIENT = 'fda5bf50-e098-43a5-8f00-69fb1769fca3';
const CALLBACK = `${ORIGIN}/api/customer/callback`;

function seal(value) {
  const key = Buffer.from(process.env.RESERVATION_SESSION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('Customer sign-in is not configured.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function unseal(value) {
  try {
    const bytes = Buffer.from(value || '', 'base64url');
    const key = Buffer.from(process.env.RESERVATION_SESSION_KEY || '', 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const record = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    return record.exp > Date.now() ? record : null;
  } catch { return null; }
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(part => {
    const at = part.indexOf('='); return [part.slice(0, at).trim(), part.slice(at + 1)];
  }));
}
function cookie(res, name, value, maxAge) {
  if (value.length > 3800) throw new Error('Customer session is too large.');
  const existing = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`]);
}
function clearSession(res) { cookie(res, '__Host-mudra-session', '', 0); }
function secureHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
}
async function exchange(params) {
  const response = await fetch(`${ACCOUNT}/authentication/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN },
    body: new URLSearchParams({ client_id: CLIENT, ...params }), signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('Please sign in again.');
  return data;
}
async function identity(accessToken) {
  const response = await fetch(`${ACCOUNT}/customer/api/2026-10/graphql`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: accessToken, Origin: ORIGIN },
    body: JSON.stringify({ query: '{ customer { id } }' }), signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok || data.errors?.length || !/^gid:\/\/shopify\/Customer\/\d+$/.test(data.data?.customer?.id || '')) throw new Error('Please sign in again.');
  return data.data.customer.id;
}
async function verifyIdToken(jwt, nonce) {
  const [headerText, payloadText, signature] = String(jwt || '').split('.');
  const header = JSON.parse(Buffer.from(headerText, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString());
  if (header.alg !== 'RS256' || payload.iss !== 'https://shopify.com/authentication/73593618511' ||
      !(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(CLIENT) || payload.nonce !== nonce ||
      payload.exp * 1000 <= Date.now()) throw new Error('Sign-in could not be verified.');
  const response = await fetch(`${ACCOUNT}/.well-known/jwks.json`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Sign-in could not be verified.');
  const jwk = (await response.json()).keys.find(key => key.kid === header.kid);
  if (!jwk || !crypto.verify('RSA-SHA256', Buffer.from(`${headerText}.${payloadText}`),
      crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature, 'base64url'))) throw new Error('Sign-in could not be verified.');
}
function login(req, res) {
  const state = crypto.randomBytes(24).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  cookie(res, '__Host-mudra-login', seal({ state, nonce, verifier, exp: Date.now() + 600000 }), 600);
  const url = new URL(`${ACCOUNT}/authentication/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: CLIENT, response_type: 'code', redirect_uri: CALLBACK,
    scope: 'openid email customer-account-api:full', state, nonce,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  res.redirect(302, url.toString());
}
async function callback(req, res) {
  const saved = unseal(cookies(req)['__Host-mudra-login']);
  cookie(res, '__Host-mudra-login', '', 0);
  if (!saved || req.query.state !== saved.state || typeof req.query.code !== 'string') throw new Error('Sign-in expired. Please try again.');
  const tokens = await exchange({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: CALLBACK, code_verifier: saved.verifier });
  await verifyIdToken(tokens.id_token, saved.nonce);
  const customerId = await identity(tokens.access_token);
  const session = { customerId, access: tokens.access_token, refresh: tokens.refresh_token,
    accessUntil: Date.now() + Number(tokens.expires_in) * 1000, csrf: crypto.randomBytes(24).toString('base64url'), exp: Date.now() + 604800000 };
  cookie(res, '__Host-mudra-session', seal(session), 604800);
  res.redirect(302, '/pre-orders');
}
async function session(req, res) {
  const saved = unseal(cookies(req)['__Host-mudra-session']);
  if (!saved) return null;
  try {
    if (saved.accessUntil < Date.now() + 60000) {
      const tokens = await exchange({ grant_type: 'refresh_token', refresh_token: saved.refresh });
      saved.access = tokens.access_token; saved.refresh = tokens.refresh_token || saved.refresh;
      saved.accessUntil = Date.now() + Number(tokens.expires_in) * 1000;
      cookie(res, '__Host-mudra-session', seal(saved), Math.floor((saved.exp - Date.now()) / 1000));
    }
    if (await identity(saved.access) !== saved.customerId) throw new Error('Identity changed.');
    return saved;
  } catch { clearSession(res); return null; }
}
function requireCsrf(req, saved) {
  if (req.headers.origin !== ORIGIN || !saved || req.headers['x-mudra-csrf'] !== saved.csrf) throw new Error('Please refresh the page and try again.');
}
module.exports = { ORIGIN, seal, unseal, cookie, cookies, session, login, callback, requireCsrf, clearSession, secureHeaders };
