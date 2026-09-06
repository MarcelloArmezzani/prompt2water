import { CHATGPT_SHARE_HEADERS, decodeLoader, extractLoaderPayload } from 'chatgpt-share-parser';
import { parseChatGptShare } from '../src/share2.js';

const ALLOWED_ORIGINS = new Set([
  'https://marcelloarmezzani.github.io',
  'http://localhost:8000',
  'http://localhost:3000',
]);

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function validShare(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    if (url.protocol !== 'https:') return null;
    if (!['chatgpt.com', 'chat.openai.com'].includes(url.hostname)) return null;
    if (!/^\/share\/(?:e\/)?[A-Za-z0-9-]{16,}/.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

function modernData(html) {
  const loader = extractLoaderPayload(html);
  if (!loader) return null;
  const decoded = decodeLoader(loader);
  const loaderData = decoded?.loaderData;
  if (!loaderData || typeof loaderData !== 'object') return null;
  const route = loaderData['routes/share.$shareId.($action)'];
  const data = route?.serverResponse?.data;
  return data && typeof data === 'object' ? data : null;
}

function legacyData(html) {
  const match = String(html).match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const payload = JSON.parse(match[1]);
    return payload?.props?.pageProps?.serverResponse?.data || null;
  } catch {
    return null;
  }
}

async function fetchConversation(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      headers: CHATGPT_SHARE_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ChatGPT returned HTTP ${response.status}`);
    const html = await response.text();
    const data = modernData(html) || legacyData(html);
    if (!data) throw new Error('ChatGPT share payload was not found');
    return parseChatGptShare(data);
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  const share = validShare(req.query?.url);
  if (!share) return res.status(400).json({ error: 'Invalid public ChatGPT share link' });

  try {
    const conversation = await fetchConversation(share);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400');
    return res.status(200).json(conversation);
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'ChatGPT took too long to return this public share.'
      : String(error?.message || error);
    return res.status(502).json({ error: message });
  }
}
