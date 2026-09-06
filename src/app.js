import { MODELS, THINKING_CHOICES } from './parameters.js';
import { loadShare } from './share2.js?v=5';
import { estimateConversation } from './core.js?v=4';

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtInt=n=>Number(n||0).toLocaleString('en-US');
const fmtWater=n=>`${Number(n||0).toFixed(2)} mL`;
const fmtEnergy=n=>`${Number(n||0).toFixed(3)} Wh`;
let prefetchTimer=null,lastPrefetch='';

function init(){
  const select=$('#model');
  for(const [name] of MODELS){const o=document.createElement('option');o.value=o.textContent=name;if(name==='GPT-5.6 Sol')o.selected=true;select.appendChild(o);}
  const wrap=$('#thinking');
  for(const choice of THINKING_CHOICES){const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='radio';input.name='thinking';input.value=choice;if(choice==='Standard / none')input.checked=true;span.textContent=choice.replace('Standard / none','Standard');label.append(input,span);wrap.appendChild(label);}
}
function thinking(){return document.querySelector('input[name="thinking"]:checked')?.value||'Standard / none';}
function status(msg,type='info'){$('#status').innerHTML=`<div class="notice ${type}">${msg}</div>`;}
function looksLikeShare(url){try{const u=new URL(url);return /(^|\.)chatgpt\.com$/i.test(u.hostname)&&/^\/share\/[0-9a-f-]{16,}/i.test(u.pathname);}catch{return false;}}

function prefetch(){
  const url=$('#share-url').value.trim();
  if(!looksLikeShare(url)||url===lastPrefetch)return;
  lastPrefetch=url;
  loadShare(url).catch(()=>{if(lastPrefetch===url)lastPrefetch='';});
}
function schedulePrefetch(){clearTimeout(prefetchTimer);prefetchTimer=setTimeout(prefetch,180);}

function render(r){
  $('#results').hidden=false;
  $('#effective-tokens').textContent=fmtInt(r.effectiveTokens);
  $('#water').textContent=fmtWater(r.totalWaterMl);
  $('#energy').textContent=fmtEnergy(r.energyWh);
  $('#input-tokens').textContent=fmtInt(r.visibleInputTokens);
  $('#output-tokens').textContent=fmtInt(r.visibleOutputTokens);
  $('#reasoning-tokens').textContent=fmtInt(r.reasoningTokens);
  $('#tool-tokens').textContent=fmtInt(r.toolEquivalentTokens);
  $('#turns').textContent=fmtInt(r.turns);
  $('#title').textContent=r.title||'Untitled conversation';
  $('#direct-water').textContent=fmtWater(r.directWaterMl);
  $('#indirect-water').textContent=fmtWater(r.electricityWaterMl);
  const total=Math.max(r.totalWaterMl,1e-6),share=100*r.directWaterMl/total;
  $('#split-direct').style.width=`${share}%`;$('#split-indirect').style.width=`${100-share}%`;
  const a=r.activity,items=[['Tools called',a.tool_calls],['Web searches',a.web],['Code runs',a.code],['Input images',a.image_in],['Generated images',a.image_out],['Generated videos',a.video],['Input documents',a.document_in],['Generated documents',a.document_out]];
  $('#activity').innerHTML=items.map(([k,v])=>`<div class="activity-item"><span>${esc(k)}</span><b>${fmtInt(v)}</b></div>`).join('');
  $('#results').scrollIntoView({behavior:'smooth',block:'start'});
}

async function analyze(){
  const url=$('#share-url').value.trim();if(!url){status('Paste a ChatGPT share link first.','warn');return;}
  const btn=$('#analyze');btn.disabled=true;btn.textContent='Analyzing…';$('#results').hidden=true;
  try{
    status('Reading ChatGPT conversation…','info');
    const conversation=await loadShare(url);
    const result=estimateConversation(conversation,$('#model').value,thinking());
    status(`Loaded <b>${esc(conversation.title)}</b>.`,'ok');
    render(result);
  }catch(e){console.error(e);status(esc(e.message||String(e)),'warn');}
  finally{btn.disabled=false;btn.textContent='Analyze';}
}

init();
$('#analyze').addEventListener('click',analyze);
$('#share-url').addEventListener('input',schedulePrefetch);
$('#share-url').addEventListener('paste',()=>setTimeout(prefetch,0));
$('#share-url').addEventListener('keydown',e=>{if(e.key==='Enter')analyze();});
