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
  // Current ChatGPT/Jina pages commonly look like:
  //   1. #### You said:
  //   2. #### ChatGPT said:
  // We also accept ordinary Markdown headings, bold labels and compact provider labels.
  let s = String(line || '').trim();
  s = s.replace(/^>\s*/, '');                         // blockquote
  s = s.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '');  // Markdown list marker
  s = s.replace(/^#{1,6}\s*/, '');                   // heading marker
  s = s.replace(/^\*\*|\*\*$/g, '').trim();        // bold wrapper

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

  // Remove obvious duplicate/empty chrome turns without changing legitimate repeated prompts.
  return messages.filter(m => m.text && !/^(?:New chat|Log in|Sign up)$/i.test(m.text.trim()));
}

function enrichSharedTools(conversation) {
  for (const m of conversation.messages) {
    const text = String(m.text || '');
    const extra = visibleToolsFromText(text);
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

export async function parseSharedLink(rawUrl) {
  const url = String(rawUrl || '').trim();
  const provider = sharedProvider(url);
  if (!provider) throw new Error('Paste a public share link from ChatGPT, Claude, Gemini, Grok or DeepSeek.');

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

  const parsed = parseSharedMarkdown(text, provider, url);
  if (!parsed.length) throw new Error('The shared page was reached, but no alternating user/assistant transcript was found. Try the file or pasted-transcript option.');
  return parsed;
}
