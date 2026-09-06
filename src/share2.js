import { parseSharedLink as legacyParseSharedLink, sharedProvider } from './share.js';

function emptyTools(){return {web:0,code:0,image_in:0,image_out:0,video:0,document:0};}
function addTools(a,b){const out=emptyTools();for(const k of Object.keys(out))out[k]=(a?.[k]||0)+(b?.[k]||0);return out;}

function shareId(raw){try{return new URL(raw).pathname.match(/^\/share\/([0-9a-f-]{16,})/i)?.[1]||null;}catch{return null;}}
function parseJsonText(text){
  const raw=String(text||'').trim();
  const candidates=[raw];
  const fenced=raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];if(fenced)candidates.push(fenced.trim());
  const a=raw.indexOf('{'),b=raw.lastIndexOf('}');if(a>=0&&b>a)candidates.push(raw.slice(a,b+1));
  for(const c of candidates){try{const v=JSON.parse(c);if(v&&typeof v==='object')return v;}catch{}}
  return null;
}
function nodesOf(share){
  if(Array.isArray(share?.linear_conversation))return share.linear_conversation;
  const map=share?.mapping||{};const vals=Object.values(map);if(!vals.length)return[];
  let cur=vals.find(n=>!n?.parent)||vals[0];const out=[],seen=new Set();
  while(cur&&!seen.has(cur.id)){if(cur.id)seen.add(cur.id);out.push(cur);const id=cur.children?.[0];cur=id?map[id]:null;}
  return out;
}
function contentInfo(msg){
  const c=msg?.content||{},parts=Array.isArray(c.parts)?c.parts:[];const chunks=[];const imageParts=[];let documents=0;
  for(const p of parts){
    if(typeof p==='string'){if(p.trim())chunks.push(p.trim());continue;}
    if(!p||typeof p!=='object')continue;
    const t=String(p.content_type||p.type||'').toLowerCase();
    if(t.includes('image'))imageParts.push(p);else if(t.includes('file'))documents++;
  }
  if(typeof c.text==='string'&&c.text.trim())chunks.push(c.text.trim());
  const atts=Array.isArray(msg?.metadata?.attachments)?msg.metadata.attachments:[];
  for(const a of atts){const s=`${a?.mime_type||''} ${a?.name||''}`.toLowerCase();if(/image\//.test(s)||/\.(png|jpe?g|webp|gif)\b/.test(s))imageParts.push(a);else documents++;}
  return {text:chunks.join('\n\n').trim(),imageParts,documents,type:String(c.content_type||'').toLowerCase()};
}
function assetKeys(msg, info){
  const md=msg?.metadata||{}, turn=md.turn_exchange_id||md.working_turn_id||md.request_id||'';const keys=[];
  for(const p of info.imageParts){
    const raw=p?.asset_pointer||p?.file_id||p?.id||p?.url||p?.download_url;
    if(raw)keys.push(String(raw));
  }
  if(!keys.length&&md.image_gen_title)keys.push(`title:${turn}:${md.image_gen_title}`);
  return [...new Set(keys)];
}
function turnId(msg,node){
  const md=msg?.metadata||{};
  return String(md.turn_exchange_id||md.working_turn_id||md.request_id||node?.id||'');
}
function explicitImageToolName(name){
  return /image[_-]?gen|text2im|dall[\s._-]?e/.test(String(name||'').toLowerCase());
}
function parseChatGPT(share,url){
  const nodes=nodesOf(share);if(!nodes.length)return[];
  const messages=[];let pending=emptyTools();
  const seenGenerated=new Set(),seenUserImages=new Set();
  const calledToolsByTurn=new Map();
  const flushPending=()=>{if(Object.values(pending).some(Boolean)){messages.push({role:'assistant',text:'',timestamp:null,tools:pending});pending=emptyTools();}};

  for(const node of nodes){
    const msg=node?.message;if(!msg)continue;
    const role=String(msg?.author?.role||'').toLowerCase(), md=msg.metadata||{}, info=contentInfo(msg);
    const recipient=String(msg.recipient||'').toLowerCase(), author=String(msg?.author?.name||'').toLowerCase();
    const turn=turnId(msg,node);

    // For structured ChatGPT shares, tool use is inferred ONLY from actual
    // structured calls/results. Conversation prose is never scanned for words
    // such as "generated image", "searched the web", or "ran code".
    if(role==='assistant'&&recipient&&recipient!=='all'){
      if(/web\.run|browser|search/.test(recipient))pending.web++;
      else if(/python|code[_-]?interpreter/.test(recipient))pending.code++;
      else if(/video[_-]?gen|sora|text2video/.test(recipient))pending.video++;

      if(!calledToolsByTurn.has(turn))calledToolsByTurn.set(turn,new Set());
      calledToolsByTurn.get(turn).add(recipient);
      continue;
    }

    if(role==='tool'){
      const calledSameTool=Boolean(author&&calledToolsByTurn.get(turn)?.has(author));
      const explicitKnownImageTool=explicitImageToolName(`${author} ${recipient}`);
      const isVerifiedImageGen=explicitKnownImageTool || (Boolean(md.image_gen_title)&&calledSameTool);
      if(isVerifiedImageGen){
        const keys=assetKeys(msg,info);let added=0;
        if(keys.length){for(const k of keys)if(!seenGenerated.has(k)){seenGenerated.add(k);added++;}}
        else {
          const fallback=`gen:${turn}:${md.image_gen_title||author}`;
          if(!seenGenerated.has(fallback)){seenGenerated.add(fallback);added=1;}
        }
        pending.image_out+=added;
      }
      continue;
    }

    if(role==='system')continue;
    if(md.is_visually_hidden_from_conversation)continue;
    if(['model_editable_context','thoughts','reasoning_recap'].includes(info.type))continue;

    if(role==='user'){
      flushPending();
      const tools=emptyTools();
      const keys=assetKeys(msg,info);for(const k of keys)if(!seenUserImages.has(k)){seenUserImages.add(k);tools.image_in++;}
      if(info.documents)tools.document+=info.documents;
      let text=info.text;if(!text&&tools.image_in)text='[image]';if(!text&&tools.document)text='[document]';if(!text)continue;
      messages.push({role:'user',text,timestamp:msg.create_time?String(msg.create_time):null,tools});
      continue;
    }

    if(role!=='assistant')continue;
    if(md.is_thinking_preamble_message)continue;
    const tools=addTools(emptyTools(),pending);pending=emptyTools();
    if(info.documents)tools.document+=info.documents;
    let text=info.text;
    if(!text&&!Object.values(tools).some(Boolean))continue;
    messages.push({role:'assistant',text,timestamp:msg.create_time?String(msg.create_time):null,tools});
  }
  flushPending();
  if(!messages.some(m=>m.role==='user')||!messages.some(m=>m.role==='assistant'))return[];
  return [{provider:'ChatGPT',title:String(share.title||'ChatGPT shared conversation'),messages,source_format:'chatgpt-share-json-v4',share_url:url,warnings:[]}];
}
async function fetchStructured(url){
  const id=shareId(url);if(!id)return[];const api=`https://chatgpt.com/backend-api/share/${id}`;
  for(const target of [api,`https://r.jina.ai/${api}`]){
    try{const r=await fetch(target,{headers:{Accept:'application/json,text/plain;q=0.9,*/*;q=0.8'}});if(!r.ok)continue;const data=parseJsonText(await r.text());const parsed=parseChatGPT(data,url);if(parsed.length)return parsed;}catch{}
  }
  return[];
}
function removeUnverifiedLegacyImageCounts(conversations){
  for(const conv of conversations||[])for(const msg of conv.messages||[])if(msg?.tools)msg.tools.image_out=0;
  return conversations;
}
export async function parseSharedLink(url){
  if(sharedProvider(url)==='ChatGPT'){
    const parsed=await fetchStructured(String(url).trim());if(parsed.length)return parsed;
    return removeUnverifiedLegacyImageCounts(await legacyParseSharedLink(url));
  }
  return legacyParseSharedLink(url);
}
