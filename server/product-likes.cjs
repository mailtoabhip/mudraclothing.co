'use strict';
const crypto = require('node:crypto');
const auth = require('./customer-auth.cjs');
const catalogue = require('../data/products.json');
const products = catalogue.products;
const COOKIE = '__Host-mudra-likes';
const PREFIX = 'mudra:likes:v1:';
const YEAR = 365 * 24 * 60 * 60;

function configured() {
  return Boolean((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)
    && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
    && process.env.RESERVATION_SESSION_KEY);
}
async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!configured() || !url.startsWith('https://')) throw new Error('Likes unavailable');
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command), signal: AbortSignal.timeout(8000)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('Likes unavailable');
  return data.result;
}
function visitor(req, res) {
  const saved = auth.unseal(auth.cookies(req)[COOKIE]);
  if (saved?.purpose === 'product-likes' && /^[a-f0-9]{32}$/.test(saved.id)) return saved.id;
  const id = crypto.randomBytes(16).toString('hex');
  auth.cookie(res, COOKIE, auth.seal({ purpose: 'product-likes', id, exp: Date.now() + YEAR * 1000 }), YEAR);
  return id;
}
function member(id) {
  return crypto.createHmac('sha256', process.env.RESERVATION_SESSION_KEY).update(`likes:${id}`).digest('hex');
}
const WRITE = `
local n = redis.call('INCR', KEYS[2])
if n == 1 then redis.call('EXPIRE', KEYS[2], 60) end
local ip = redis.call('INCR', KEYS[3])
if ip == 1 then redis.call('EXPIRE', KEYS[3], 60) end
if n > 30 or ip > 120 then return -1 end
if ARGV[2] == '1' then redis.call('SADD', KEYS[1], ARGV[1])
else redis.call('SREM', KEYS[1], ARGV[1]) end
return redis.call('SISMEMBER', KEYS[1], ARGV[1])`;
async function update(req, id, product, liked) {
  const browser = member(id);
  const address = req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const ip = member(`ip:${String(address).split(',')[0].trim()}`);
  const result = await redis(['EVAL', WRITE, 3, `${PREFIX}product:${product}`, `${PREFIX}rate:${browser}`, `${PREFIX}ip:${ip}`, browser, liked ? '1' : '0']);
  return Number(result);
}
async function state(id) {
  const keys = products.map(p => `${PREFIX}product:${p.id}`);
  const script = `local out = {} for i,k in ipairs(KEYS) do out[i] = redis.call('SISMEMBER', k, ARGV[1]) end return out`;
  const result = await redis(['EVAL', script, keys.length, ...keys, member(id)]);
  return products.filter((p, i) => Number(result[i]) === 1).map(p => p.id);
}
async function stats() {
  const keys = products.map(p => `${PREFIX}product:${p.id}`);
  const script = `local out = {} for i,k in ipairs(KEYS) do out[i] = redis.call('SCARD', k) end return out`;
  const result = await redis(['EVAL', script, keys.length, ...keys]);
  return products.map((p, i) => ({ id: p.id, name: p.name, likes: Number(result[i]) || 0 }));
}
module.exports = { configured, visitor, update, state, stats, products, WRITE };
