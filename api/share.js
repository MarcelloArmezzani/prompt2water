import {
  fetchChatGptShareHtml,
  extractLoaderPayload,
  decodeLoader,
} from 'chatgpt-share-parser';

const ALLOWED_ORIGIN = 'https://marcelloarmezzani.github.io';
const memoryCache = globalThis.__P2W_SHARE_CACHE__ || new Map();
globalThis.__P2W_SHARE_CACHE__ = memoryCache;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function getShareId(value) {
  const raw = String(value || '').trim();
  if (/^[0-9a-f-]{16,}$/i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (!['chatgpt.com', 'chat.openai.com'].includes(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'share') return null;
    const id = parts[1] === 'e' ? parts[2] : parts[1];
    return id && /^[0-9a-f-]{16,}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

function isRecord(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function looksLikeConversation(v) {
  return isRecord(v) && (
    (Array.isArray(v.linear_conversation) && v.linear_conversation.length > 0) ||
    (isRecord(v.mapping) && Object.keys(v.mapping).length > 0)
  );
}

function findConversation(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (looksLikeConversation(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findConversation(item, seen);
      if (found) return found;
    }
  } else {
    for (const item of Object.values(value)) {
      const found = findConversation(item, seen);
      if (found) return found;
    }
  }
  return null;
}

function rawDataFromHtml(html) {
  const loader = extractLoaderPayload(html);
  if (loader) {
    const decoded = decodeLoader(loader);
    const fixed = decoded?.loaderData?.['routes/share.$shareId.($action)']?.serverResponse?.data;
    if (looksLikeConversation(fixed)) return fixed;
    const discovered = findConversation(decoded);
    if (discovered) return discovered;
  }

  const next = String(html).match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (next) {
    try {
      const payload = JSON.parse(next);
      const fixed = payload?.props?.pageProps?.serverResponse?.data;
      if (looksLikeConversation(fixed)) return fixed;
      const discovered = findConversation(payload);
      if (discovered) return discovered;
    } catch {}
  }
  return null;
}

function slimConversation(data) {
  // Keep the fields Prompt2Water actually uses, while preserving all message
  // metadata/content needed for tool, image, video and document detection.
  const out = {
    title: data.title || 'Shared ChatGPT conversation',
    update_time: data.update_time ?? null,
    conversation_id: data.conversation_id ?? null,
    linear_conversation: Array.isArray(data.linear_conversation) ? data.linear_conversation : [],
  };
  if (isRecord(data.mapping)) out.mapping = data.mapping;
  if (isRecord(data.model)) out.model = data.model;
  return out;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const id = getShareId(req.query?.id || req.query?.url);
  if (!id) {
    res.status(400).json({ error: 'Invalid public ChatGPT share link.' });
    return;
  }

  const cached = memoryCache.get(id);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
    res.setHeader('X-Prompt2Water-Cache', 'memory');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    res.status(200).json(cached.value);
    return;
  }

  const shareUrl = `https://chatgpt.com/share/${id}`;
  try {
    const html = await fetchChatGptShareHtml(shareUrl);
    const data = rawDataFromHtml(html);
    if (!data) {
      res.status(502).json({ error: 'ChatGPT returned the share page, but its conversation payload could not be decoded.' });
      return;
    }
    const value = slimConversation(data);
    memoryCache.set(id, { at: Date.now(), value });
    if (memoryCache.size > 32) memoryCache.delete(memoryCache.keys().next().value);

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Prompt2Water-Cache', 'miss');
    res.status(200).json(value);
  } catch (error) {
    console.error('share fetch failed', error);
    res.status(502).json({ error: 'Could not retrieve this public ChatGPT conversation.' });
  }
}
