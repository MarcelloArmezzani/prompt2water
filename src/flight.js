// Minimal decoder for the React Router payload embedded in current ChatGPT
// public share pages. Adapted from the MIT-licensed chatgpt-share-parser
// implementation by Evan Hu / ChatPeek.

function scriptsIn(html=''){
  const scripts=[];
  const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for(const m of String(html).matchAll(re)) scripts.push(m[2]||'');
  return scripts;
}

function callArgument(text,start){
  let quote=null,escaped=false,depth=1;
  for(let i=start;i<text.length;i++){
    const ch=text[i];
    if(quote){
      if(escaped)escaped=false;
      else if(ch==='\\')escaped=true;
      else if(ch===quote)quote=null;
      continue;
    }
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='('){depth++;continue;}
    if(ch===')'){
      depth--;
      if(depth===0)return{argument:text.slice(start,i).trim(),end:i+1};
    }
  }
  return null;
}

function stripParens(value){
  let s=String(value||'').trim();
  while(s.startsWith('(')&&s.endsWith(')'))s=s.slice(1,-1).trim();
  return s;
}

function parseEnqueued(argument){
  const s=stripParens(argument);
  let chunk=s;
  if(s.startsWith('"')){
    try{chunk=JSON.parse(s);}catch{return null;}
  }
  if(typeof chunk==='string'){
    const t=chunk.trim();
    if(!t.startsWith('['))return null;
    try{const v=JSON.parse(t);return Array.isArray(v)?v:null;}catch{return null;}
  }
  if(Array.isArray(chunk))return chunk;
  if(s.startsWith('[')){
    try{const v=JSON.parse(s);return Array.isArray(v)?v:null;}catch{return null;}
  }
  return null;
}

export function extractLoaderPayload(html){
  const call='streamController.enqueue(';
  for(const text of scriptsIn(html)){
    if(!text.includes(call))continue;
    let start=0;
    while(start<text.length){
      const anchor=text.indexOf(call,start);
      if(anchor<0)break;
      const found=callArgument(text,anchor+call.length);
      if(!found)break;
      const payload=parseEnqueued(found.argument);
      if(payload)return payload;
      start=found.end;
    }
  }
  return null;
}

export function decodeLoader(loader){
  const cache=new Map();
  const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const decodeKey=key=>{
    if(/^_\d+$/.test(key)){
      const v=loader[Number(key.slice(1))];
      if(typeof v==='string')return v;
    }
    return key;
  };
  const resolve=value=>{
    if(typeof value==='number'&&Number.isInteger(value)){
      if(cache.has(value))return cache.get(value);
      if(value<0||value>=loader.length)return value;
      cache.set(value,null);
      const v=resolve(loader[value]);
      cache.set(value,v);
      return v;
    }
    if(Array.isArray(value))return value.map(resolve);
    if(isObj(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[decodeKey(k),resolve(v)]));
    return value;
  };
  const decoded={};
  for(let i=1;i<loader.length-1;i+=2){
    const key=loader[i];
    if(typeof key==='string'&&!(key in decoded))decoded[key]=resolve(loader[i+1]);
  }
  return decoded;
}

export function shareDataFromHtml(html){
  const loader=extractLoaderPayload(html);
  if(loader){
    const decoded=decodeLoader(loader);
    const data=decoded?.loaderData?.['routes/share.$shareId.($action)']?.serverResponse?.data;
    if(data&&typeof data==='object')return data;
  }
  const next=String(html).match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if(next){
    try{
      const payload=JSON.parse(next);
      const data=payload?.props?.pageProps?.serverResponse?.data;
      if(data&&typeof data==='object')return data;
    }catch{}
  }
  return null;
}
