import { parseRoleText, visibleToolsFromText } from './parsers.js';

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

function normalizeRoleMarkers(markdown, provider) {
  let t = stripReaderChrome(markdown);
  const assistantNames = ['Assistant', 'AI', 'ChatGPT', 'Claude', 'Gemini', 'Grok', 'DeepSeek'];
  const userNames = ['User', 'You', 'Human', 'Me'];

  const convert = (names, role) => {
    const group = names.join('|');
    // Block headings: ## You, You said:, ## ChatGPT said
    t = t.replace(new RegExp(`^\\s*#{0,6}\\s*(?:${group})(?:\\s+said)?\\s*:?\\s*$`, 'gim'), `${role}:`);
    // Numbered headings produced by some share parsers: ## User 01
    t = t.replace(new RegExp(`^\\s*#{1,6}\\s*(?:${group})\\s+\\d+\\s*$`, 'gim'), `${role}:`);
    // Inline role prefix: You said: hello
    t = t.replace(new RegExp(`^\\s*#{0,6}\\s*(?:${group})(?:\\s+said)?\\s*:\\s*(.+)$`, 'gim'), `${role}: $1`);
  };
  convert(userNames, 'User');
  convert(assistantNames, 'Assistant');

  // Provider pages sometimes use compact labels without punctuation.
  if (provider === 'Gemini') t = t.replace(/^\s*Prompt\s*$/gim, 'User:').replace(/^\s*Response\s*$/gim, 'Assistant:');
  return t;
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
  const normalized = normalizeRoleMarkers(markdown, provider);
  const parsed = parseRoleText(normalized, provider, 'public-share-link');
  if (!parsed.length) return [];
  const conv = enrichSharedTools(parsed[0]);
  conv.title = pageTitle(markdown, provider);
  conv.share_url = url;
  conv.warnings = [];
  return [conv];
}

export async function parseSharedLink(rawUrl) {
  const url = String(rawUrl || '').trim();
  const provider = sharedProvider(url);
  if (!provider) throw new Error('Paste a public share link from ChatGPT, Claude, Gemini, Grok or DeepSeek.');

  // Public share pages are fetched through Jina Reader so this static GitHub Pages
  // site can read cross-origin, JavaScript-rendered pages without its own backend.
  const readerUrl = `https://r.jina.ai/${url}`;
  let response;
  try {
    response = await fetch(readerUrl, { headers: { Accept: 'text/plain' } });
  } catch {
    throw new Error('The shared page could not be reached. Try the file-upload option instead.');
  }
  if (!response.ok) throw new Error(`${provider} did not allow this shared page to be read automatically. Try the file-upload option instead.`);
  const text = await response.text();
  if (!text || text.length < 80) throw new Error('The shared page did not contain a readable conversation.');

  const parsed = parseSharedMarkdown(text, provider, url);
  if (!parsed.length) throw new Error('The page opened, but the conversation could not be separated into user and assistant turns. Try uploading the export instead.');
  return parsed;
}
