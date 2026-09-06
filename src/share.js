import { visibleToolsFromText } from './parsers.js';

const PROVIDERS = [
  { name: 'ChatGPT', test: u => /(^|\.)chatgpt\.com$/i.test(u.hostname) && u.pathname.startsWith('/share/') },
  { name: 'Claude', test: u => /(^|\.)claude\.ai$/i.test(u.hostname) && u.pathname.startsWith('/share/') },
  { name: 'Gemini', test: u => (/^g\.co$/i.test(u.hostname) && u.pathname.startsWith('/gemini/share/')) || (/gemini\.google\.com$/i.test(u.hostname) && /share/i.test(u.pathname)) },
  { name: 'Grok', test: u => /(^|\.)grok\.com$/i.test(u.hostname) && u.pathname.startsWith('/share/') },
  { name: 'DeepSeek', test: u => /(^|\.)deepseek\.com$/i.test(u.hostname) && /share/i.test(u.href) }
];

export function sharedProvider(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl).trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  return PROVIDERS.find(p => p.test(u))?.name || null;
}

function pageTitle(markdown, provider) {
  const title = markdown.match(/^Title:\s*(.+)$/mi)?.[1]?.trim();
  if (title && !/^(ChatGPT|Claude|Gemini|Grok|DeepSeek)$/i.test(title)) return title.slice(0, 120);
  const h1 = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (h1 || `${provider} shared conversation`).slice(0, 120);
}

function stripReaderChrome(text) {
  return String(text || '')
    .replace(/^Title:.*$/gmi, '')
    .replace(/^URL Source:.*$/gmi, '')
    .replace(/^Published Time:.*$/gmi, '')
    .replace(/^Markdown Content:\s*$/gmi, '')
    .replace(/^\s*(?:Log in|Sign up|Share|Copy link|Continue this chat|Report(?: conversation)?|New chat|Search chats)\s*$/gmi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const USER_NAMES = ['user', 'you', 'human', 'me'];
const ASSISTANT_NAMES = ['assistant', 'ai', 'chatgpt', 'claude', 'gemini', 'grok', 'deepseek'];

function classifyMarker(line, provider) {
  let s = String(line || '').trim();
  s = s.replace(/^>\s*/, '');
  s = s.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '');
  s = s.replace(/^#{1,6}\s*/, '');
  s = s.replace(/^\*\*|\*\*$/g, '').trim();

  const m = s.match(/^([^:]{1,40}?)(?:\s+said)?\s*:\s*(.*)$/i)
        || s.match(/^([^:]{1,40}?)(?:\s+said)?\s*$/i);
  if (!m) return null;

  const name = String(m[1] || '').replace(/\s+\d+$/, '').trim().toLowerCase();
  const remainder = String(m[2] || '').trim();
  if (USER_NAMES.includes(name) || (provider === 'Gemini' && name === 'prompt')) return { role: 'user', remainder };
  if (ASSISTANT_NAMES.includes(name) || (provider === 'Gemini' && name === 'response')) return { role: 'assistant', remainder };
  return null;
}

function cleanMessageText(text) {
  return String(text || '')
    .replace(/^\s*\[Button:[^\]]+\]\s*$/gmi, '')
    .replace(/^\s*\[Input(?::[^\]]*)?\]\s*$/gmi, '')
    .replace(/^\s*(?:Chat with ChatGPT|ChatGPT is AI\..*|Clear current chat\?|Settings|Help|See plans and pricing)\s*$/gmi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseMarkedTranscript(markdown, provider) {
  const text = stripReaderChrome(markdown);
  const lines = text.split(/\r?\n/);
  const messages = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const body = cleanMessageText(current.parts.join('\n'));
    if (body) messages.push({ role: current.role, text: body, timestamp: null, tools: visibleToolsFromText(body) });
    current = null;
  };

  for (const line of lines) {
    const marker = classifyMarker(line, provider);
    if (marker) {
      flush();
      current = { role: marker.role, parts: marker.remainder ? [marker.remainder] : [] };
    } else if (current) {
      current.parts.push(line);
    }
  }
  flush();
  return messages.filter(m => m.text && !/^(?:New chat|Log in|Sign up)$/i.test(m.text.trim()));
}

function enrichSharedTools(conversation) {
  for (const m of conversation.messages) {
    const text = String(m.text || '');
    const extra = m.tools || visibleToolsFromText(text);
    if (/^\s*Sources?\s*:?/mi.test(text) || /\b(?:web results?|searched the web)\b/i.test(text)) extra.web = Math.max(extra.web, 1);
    const images = [...text.matchAll(/!\[[^\]]*\]\([^\)]+\)/g)].length;
    if (images) {
      if (m.role === 'user') extra.image_in += images;
      if (m.role === 'assistant') extra.image_out += images;
    }
    if (/\b(?:generated|created)\s+(?:a\s+)?video\b/i.test(text)) extra.video = Math.max(extra.video, 1);
    m.tools = extra;
  }
  return conversation;
}

export function parseSharedMarkdown(markdown, provider, url) {
  const messages = parseMarkedTranscript(markdown, provider);
  if (!messages.length || !messages.some(m => m.role === 'user') || !messages.some(m => m.role === 'assistant')) return [];
  const conv = enrichSharedTools({
    provider,
    title: pageTitle(markdown, provider),
    messages,
    source_format: 'public-share-link',
    share_url: url,
    warnings: []
  });
  return [conv];
}

function chatGptShareId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.pathname.match(/^\/share\/([0-9a-f-]{16,})/i)?.[1] || null;
  } catch { return null; }
}

function parseJsonFromText(text) {
  const raw = String(text || '').trim();
  const attempts = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) attempts.push(fenced.trim());
  const first = raw.indexOf('{'), last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) attempts.push(raw.slice(first, last + 1));
  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return value;
    } catch {}
  }
  return null;
}

function orderedChatGptNodes(share) {
  if (Array.isArray(share?.linear_conversation) && share.linear_conversation.length) return share.linear_conversation;
  const mapping = share?.mapping && typeof share.mapping === 'object' ? share.mapping : {};
  const nodes = Object.values(mapping);
  if (!nodes.length) return [];
  let cursor = nodes.find(n => !n?.parent) || nodes[0];
  const out = [], seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    if (cursor.id) seen.add(cursor.id);
    out.push(cursor);
    const child = Array.isArray(cursor.children) ? cursor.children[0] : null;
    cursor = child ? mapping[child] : null;
  }
  return out;
}

function chatGptVisibleContent(msg) {
  const content = msg?.content || {};
  const type = String(content.content_type || '').toLowerCase();
  if (['model_editable_context', 'thoughts'].includes(type)) return { text: '', images: 0, documents: 0 };

  const chunks = [];
  let images = 0, documents = 0;
  const parts = Array.isArray(content.parts) ? content.parts : [];
  for (const part of parts) {
    if (typeof part === 'string') {
      if (part.trim()) chunks.push(part.trim());
      continue;
    }
    if (!part || typeof part !== 'object') continue;
    const pt = String(part.content_type || part.type || '').toLowerCase();
    if (pt.includes('image')) images++;
    else if (pt.includes('file')) documents++;
  }
  if (typeof content.text === 'string' && content.text.trim()) chunks.push(content.text.trim());

  const atts = Array.isArray(msg?.metadata?.attachments) ? msg.metadata.attachments : [];
  for (const a of atts) {
    const s = `${a?.mime_type || ''} ${a?.name || ''}`.toLowerCase();
    if (/image\//.test(s) || /\.(png|jpe?g|webp|gif)\b/.test(s)) images++;
    else documents++;
  }

  return { text: chunks.join('\n\n').trim(), images, documents };
}

function emptyTools() {
  return { web: 0, code: 0, image_in: 0, image_out: 0, video: 0, document: 0 };
}

function addToolCounts(a, b) {
  const out = emptyTools();
  for (const k of Object.keys(out)) out[k] = (a?.[k] || 0) + (b?.[k] || 0);
  return out;
}

function emptyPending() {
  return { web: 0, code: 0, imageCalls: 0, imageResults: 0, videoCalls: 0, videoResults: 0 };
}

function hasPending(p) {
  return Object.values(p).some(v => v > 0);
}

function pendingToTools(p) {
  return {
    web: p.web,
    code: p.code,
    image_in: 0,
    image_out: Math.max(p.imageCalls, p.imageResults),
    video: Math.max(p.videoCalls, p.videoResults),
    document: 0
  };
}

function toolCallKind(msg) {
  const recipient = String(msg?.recipient || '').toLowerCase();
  const authorName = String(msg?.author?.name || '').toLowerCase();
  const s = `${recipient} ${authorName}`;
  if (/image[_-]?gen|text2im|dall[\s._-]?e/.test(s)) return 'image';
  if (/video[_-]?gen|sora|text2video/.test(s)) return 'video';
  if (/web\.run|browser|search/.test(s)) return 'web';
  if (/python|code[_-]?interpreter/.test(s)) return 'code';
  return null;
}

function parseChatGptShareJson(share, url) {
  if (!share || (!Array.isArray(share.linear_conversation) && !share.mapping)) return [];
  const messages = [];
  let pending = emptyPending();

  const flushPendingAsAssistant = () => {
    if (!hasPending(pending)) return;
    messages.push({ role: 'assistant', text: '', timestamp: null, tools: pendingToTools(pending) });
    pending = emptyPending();
  };

  for (const node of orderedChatGptNodes(share)) {
    const msg = node?.message;
    if (!msg) continue;
    const role = String(msg?.author?.role || '').toLowerCase();
    const meta = msg.metadata || {};
    if (meta.is_visually_hidden_from_conversation) continue;

    const visible = chatGptVisibleContent(msg);
    const callKind = toolCallKind(msg);
    const recipient = String(msg?.recipient || '').toLowerCase();
    const isAssistantToolCall = role === 'assistant' && callKind && recipient && recipient !== 'all';

    if (isAssistantToolCall) {
      if (callKind === 'image') pending.imageCalls++;
      else if (callKind === 'video') pending.videoCalls++;
      else if (callKind === 'web') pending.web++;
      else if (callKind === 'code') pending.code++;
      continue;
    }

    if (role === 'tool') {
      if (visible.images) pending.imageResults += visible.images;
      if (callKind === 'video') pending.videoResults++;
      continue;
    }

    if (role === 'user') {
      // A visible user message starts a new turn. Preserve any prior tool-only assistant output first.
      flushPendingAsAssistant();
      const tools = visibleToolsFromText(visible.text);
      if (visible.images) tools.image_in += visible.images;
      if (visible.documents) tools.document += visible.documents;
      let text = visible.text;
      if (!text && visible.images) text = '[image]';
      if (!text && visible.documents) text = '[document]';
      if (!text) continue;
      messages.push({ role: 'user', text, timestamp: msg.create_time ? String(msg.create_time) : null, tools });
      continue;
    }

    if (role !== 'assistant') continue;

    // Normal visible assistant output. An image asset may be returned on this node rather than a tool node.
    if (visible.images) pending.imageResults += visible.images;
    const ownTools = visibleToolsFromText(visible.text);
    if (visible.documents) ownTools.document += visible.documents;
    const tools = addToolCounts(ownTools, pendingToTools(pending));
    pending = emptyPending();

    let text = visible.text;
    // Keep tool-only/image-only assistant turns even when there is no visible text.
    if (!text && tools.image_out === 0 && tools.video === 0 && tools.web === 0 && tools.code === 0) {
      if (visible.documents) text = '[document]';
      else continue;
    }

    messages.push({
      role: 'assistant',
      text,
      timestamp: msg.create_time ? String(msg.create_time) : null,
      tools
    });
  }

  flushPendingAsAssistant();

  if (!messages.some(m => m.role === 'user') || !messages.some(m => m.role === 'assistant')) return [];
  return [enrichSharedTools({
    provider: 'ChatGPT',
    title: String(share.title || 'ChatGPT shared conversation'),
    messages,
    source_format: 'chatgpt-share-json',
    share_url: url,
    warnings: []
  })];
}

async function fetchChatGptStructured(url) {
  const id = chatGptShareId(url);
  if (!id) return [];
  const apiUrl = `https://chatgpt.com/backend-api/share/${id}`;
  const candidates = [apiUrl, `https://r.jina.ai/${apiUrl}`];

  for (const target of candidates) {
    try {
      const response = await fetch(target, { headers: { Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8' } });
      if (!response.ok) continue;
      const text = await response.text();
      const data = parseJsonFromText(text);
      const parsed = parseChatGptShareJson(data, url);
      if (parsed.length) return parsed;
    } catch {}
  }
  return [];
}

async function fetchReaderMarkdown(url, provider) {
  const readerUrl = `https://r.jina.ai/${url}`;
  let response;
  try {
    response = await fetch(readerUrl, { headers: { Accept: 'text/plain' } });
  } catch {
    throw new Error('The shared page could not be reached. Try the file or pasted-transcript option.');
  }
  if (!response.ok) throw new Error(`${provider} did not allow this shared page to be read automatically. Try the file or pasted-transcript option.`);
  const text = await response.text();
  if (!text || text.length < 80) throw new Error('The shared page did not contain a readable conversation.');
  return text;
}

export async function parseSharedLink(rawUrl) {
  const url = String(rawUrl || '').trim();
  const provider = sharedProvider(url);
  if (!provider) throw new Error('Paste a public share link from ChatGPT, Claude, Gemini, Grok or DeepSeek.');

  if (provider === 'ChatGPT') {
    const structured = await fetchChatGptStructured(url);
    if (structured.length) return structured;
  }

  const text = await fetchReaderMarkdown(url, provider);
  const parsed = parseSharedMarkdown(text, provider, url);
  if (!parsed.length) throw new Error('The shared page was reached, but no alternating user/assistant transcript was found. Try the file or pasted-transcript option.');
  return parsed;
}
