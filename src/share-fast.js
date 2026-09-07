import { loadShare as loadLegacyShare } from './share2.js?v=6';

const CACHE_PREFIX = 'p2w:fast-share:v1:';
const CACHE_TTL_MS = 10 * 60 * 1000;
const memory = new Map();
const pending = new Map();

function shareInfo(rawUrl) {
  try {
    const u = new URL(String(rawUrl).trim());
    if (u.protocol !== 'https:' || !/(^|\.)chatgpt\.com$/i.test(u.hostname)) return null;
    const id = u.pathname.match(/^\/share\/([0-9a-f-]{16,})/i)?.[1];
    if (!id) return null;
    return { id, url: `https://chatgpt.com/share/${id}` };
  } catch {
    return null;
  }
}

function apiEndpoint(id) {
  const explicit = String(globalThis.PROMPT2WATER_API_ENDPOINT || '').trim();
  if (explicit) {
    const separator = explicit.includes('?') ? '&' : '?';
    return `${explicit}${separator}id=${encodeURIComponent(id)}`;
  }
  if (typeof location !== 'undefined') {
    const host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app')) {
      return `/api/share?id=${encodeURIComponent(id)}`;
    }
  }
  return null;
}

function readCache(id) {
  const now = Date.now();
  const hit = memory.get(id);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + id);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved?.value || now - Number(saved.at || 0) >= CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + id);
      return null;
    }
    memory.set(id, saved);
    return saved.value;
  } catch {
    return null;
  }
}

function writeCache(id, value) {
  const saved = { at: Date.now(), value };
  memory.set(id, saved);
  try {
    localStorage.setItem(CACHE_PREFIX + id, JSON.stringify(saved));
  } catch {
    // Large conversations may exceed browser storage; memory cache still works.
  }
}

async function loadFromApi(id) {
  const endpoint = apiEndpoint(id);
  if (!endpoint) return null;
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Share service returned HTTP ${response.status}.`);
  if (!body || !Array.isArray(body.turns)) throw new Error('Share service returned an invalid conversation.');
  return { title: body.title || 'Shared ChatGPT conversation', turns: body.turns };
}

export async function loadShare(rawUrl) {
  const info = shareInfo(rawUrl);
  if (!info) throw new Error('Paste a public ChatGPT share link.');

  const cached = readCache(info.id);
  if (cached) return cached;
  if (pending.has(info.id)) return pending.get(info.id);

  const promise = (async () => {
    let conversation;
    const endpoint = apiEndpoint(info.id);
    if (endpoint) {
      conversation = await loadFromApi(info.id);
    } else {
      // Temporary compatibility path for the GitHub Pages deployment until
      // the serverless endpoint is connected to it.
      conversation = await loadLegacyShare(info.url);
    }
    writeCache(info.id, conversation);
    return conversation;
  })();

  pending.set(info.id, promise);
  try {
    return await promise;
  } finally {
    pending.delete(info.id);
  }
}
