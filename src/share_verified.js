import { parseSharedLink as parseBaseSharedLink, sharedProvider } from './share.js';

function shareId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.pathname.match(/^\/share\/([0-9a-f-]{16,})/i)?.[1] || null;
  } catch { return null; }
}

function parseReaderJson(text) {
  const raw = String(text || '').trim();
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) candidates.push(fenced.trim());
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) candidates.push(raw.slice(a, b + 1));
  for (const s of candidates) {
    try {
      const value = JSON.parse(s);
      if (value && typeof value === 'object') return value;
    } catch {}
  }
  return null;
}

function nodesFromShare(data) {
  if (Array.isArray(data?.linear_conversation)) return data.linear_conversation;
  if (data?.mapping && typeof data.mapping === 'object') return Object.values(data.mapping);
  return [];
}

function explicitGeneratedImageCount(data) {
  const generations = new Set();

  for (const node of nodesFromShare(data)) {
    const msg = node?.message;
    if (!msg) continue;
    const meta = msg.metadata || {};

    // image_gen_title is the explicit marker ChatGPT places on generated-image
    // result nodes. Plain image_asset_pointer objects without this marker are
    // uploads, cached assets, or multimodal plumbing and must not be counted.
    const title = String(meta.image_gen_title || '').trim();
    if (!title) continue;

    const turn = String(meta.turn_exchange_id || meta.working_turn_id || meta.request_id || '');
    const content = msg.content || {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const pointers = [];

    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const type = String(part.content_type || part.type || '').toLowerCase();
      if (!type.includes('image')) continue;
      const pointer = String(part.asset_pointer || part.image_asset_pointer || part.file_id || part.id || '').trim();
      if (pointer) pointers.push(pointer);
    }

    // Multiple internal nodes can expose the same generated image. The turn +
    // title key deliberately collapses those duplicates. If a provider later
    // exposes multiple distinct generated assets in one turn, unique pointers
    // are retained when they are present.
    if (pointers.length > 1) {
      for (const pointer of new Set(pointers)) generations.add(`${turn}|${title}|${pointer}`);
    } else {
      generations.add(`${turn}|${title}`);
    }
  }

  return generations.size;
}

async function verifiedChatGptGeneratedImages(rawUrl) {
  const id = shareId(rawUrl);
  if (!id) return null;
  const api = `https://chatgpt.com/backend-api/share/${id}`;
  try {
    const response = await fetch(`https://r.jina.ai/${api}`, { headers: { Accept: 'text/plain' } });
    if (!response.ok) return null;
    const data = parseReaderJson(await response.text());
    if (!data) return null;
    return explicitGeneratedImageCount(data);
  } catch {
    return null;
  }
}

function applyVerifiedImageCount(conversations, count) {
  if (!Array.isArray(conversations) || !conversations.length || count == null) return conversations;

  // Remove every heuristic ChatGPT generated-image count first. This prevents
  // ordinary image_asset_pointer nodes from being misclassified as generations.
  for (const conv of conversations) {
    for (const msg of conv.messages || []) {
      if (msg?.tools) msg.tools.image_out = 0;
    }
  }

  if (count > 0) {
    const conv = conversations[0];
    const assistant = [...(conv.messages || [])].reverse().find(m => m.role === 'assistant');
    if (assistant) {
      assistant.tools ||= { web:0, code:0, image_in:0, image_out:0, video:0, document:0 };
      assistant.tools.image_out = count;
    }
  }
  return conversations;
}

export async function parseSharedLink(rawUrl) {
  const provider = sharedProvider(rawUrl);
  const conversations = await parseBaseSharedLink(rawUrl);
  if (provider !== 'ChatGPT') return conversations;

  const count = await verifiedChatGptGeneratedImages(rawUrl);
  return applyVerifiedImageCount(conversations, count);
}

export { sharedProvider };
