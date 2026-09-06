import { MODEL_GROUPS, THINKING_CHOICES, OUTPUT_ENERGY_WH_PER_TOKEN, REFERENCES } from './parameters.js';
import { estimateConversation } from './core.js';
import { parseFile, parsePasted } from './importer.js';
import { parseSharedLink } from './share.js';
import { downloadText,jsonText,htmlText } from './report.js';

const $=s=>document.querySelector(s);
let conversations=[], currentEstimate=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'—';

function initModels(){
  const select=$('#model');
  for(const [group,models] of MODEL_GROUPS){
    const optg=document.createElement('optgroup'); optg.label=group;
    for(const [name] of models){const o=document.createElement('option');o.value=o.textContent=name;if(name==='GPT-5.6 Sol')o.selected=true;optg.appendChild(o);} select.appendChild(optg);
  }
  const wrap=$('#thinking');
  for(const name of THINKING_CHOICES){
    const label=document.createElement('label');label.className='seg';
    const input=document.createElement('input');input.type='radio';input.name='thinking';input.value=name;if(name==='Standard / none')input.checked=true;
    const span=document.createElement('span');span.textContent=name.replace('Standard / none','Standard');label.append(input,span);wrap.appendChild(label);
  }
}
function thinking(){return $('input[name="thinking"]:checked')?.value||'Standard / none';}
function status(text,type='info'){const el=$('#import-status');el.innerHTML=text?`<div class="notice ${type}">${text}</div>`:'';}
function clearResult(){$('#results').hidden=true;currentEstimate=null;}
function loadConversations(parsed,sourceLabel='conversation'){
  conversations=parsed;
  if(!conversations.length)throw new Error('No readable conversation was found.');
  const sel=$('#conversation');sel.innerHTML='';
  conversations.forEach((c,i)=>{const n=c.messages.filter(m=>m.role==='assistant').length;const o=document.createElement('option');o.value=i;o.textContent=`${c.title} · ${n} responses`;sel.appendChild(o);});
  $('#conversation-wrap').hidden=conversations.length<2;
  $('#analyze').disabled=false;
  const c=conversations[0];
  status(`<b>${esc(c.provider)}</b> · ${c.messages.length} visible messages loaded from ${esc(sourceLabel)}.`,'ok');
}
async function readLink(){
  clearResult();const url=$('#share-url').value.trim();if(!url){status('Paste a public shared-conversation link first.','warn');return;}
  const btn=$('#read-link');btn.disabled=true;btn.textContent='Reading…';status('Reading the shared conversation…','info');
  try{loadConversations(await parseSharedLink(url),'shared link');}
  catch(e){console.error(e);status(esc(e.message||e),'warn');}
  finally{btn.disabled=false;btn.textContent='Read chat';}
}
async function readFile(){
  clearResult();const file=$('#file').files[0];if(!file)return;
  status('Opening export…','info');
  try{loadConversations(await parseFile(file),file.name);}catch(e){status(esc(e.message||e),'warn');}
}
function readPaste(){
  clearResult();const text=$('#paste').value.trim();if(!text){status('Paste a transcript using User: and Assistant: labels.','warn');return;}
  try{loadConversations(parsePasted(text),'pasted transcript');}catch(e){status(esc(e.message||e),'warn');}
}
function analyze(){if(!conversations.length)return;const c=conversations[Number($('#conversation').value)||0];currentEstimate=estimateConversation(c,$('#model').value,thinking());render(currentEstimate);}
function render(est){
  $('#results').hidden=false;
  $('#water').textContent=`${fmt(est.total_water_ml)} mL`;
  $('#energy').textContent=`${fmt(est.total_energy_wh,3)} Wh`;
  $('#turn-count').textContent=est.turns.length;
  $('#direct').textContent=`${fmt(est.direct_water_ml)} mL`;
  $('#indirect').textContent=`${fmt(est.electricity_water_ml)} mL`;
  $('#model-class').textContent=`${est.model_class} · ${(OUTPUT_ENERGY_WH_PER_TOKEN[est.model_class]*1000).toFixed(2)} Wh / 1000 output tokens`;
  const share=est.total_water_ml?100*est.direct_water_ml/est.total_water_ml:0;
  $('#split-direct').style.width=`${share}%`;$('#split-indirect').style.width=`${100-share}%`;
  const t=est.tools;
  $('#tools').innerHTML=[['Web searches',t.web],['Code runs',t.code],['Input images',t.image_in],['Generated images',t.image_out],['Videos',t.video],['Documents',t.document]].map(([k,v])=>`<div class="tool-chip"><span>${esc(k)}</span><b>${v}</b></div>`).join('');
  $('#warnings').innerHTML=est.warnings.map(w=>`<div class="notice warn">${esc(w)}</div>`).join('');
  $('#results').scrollIntoView({behavior:'smooth',block:'start'});
}
function setupDownloads(){
  $('#download-json').onclick=()=>currentEstimate&&downloadText('prompt2water-estimate.json',jsonText(currentEstimate),'application/json');
  $('#download-html').onclick=()=>currentEstimate&&downloadText('prompt2water-report.html',htmlText(currentEstimate),'text/html');
  $('#print').onclick=()=>window.print();
}
function setupRefs(){$('#references').innerHTML=REFERENCES.map(([n,u])=>`<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a></li>`).join('');}

initModels();setupDownloads();setupRefs();
$('#read-link').onclick=readLink;$('#share-url').addEventListener('keydown',e=>{if(e.key==='Enter')readLink();});
$('#file').addEventListener('change',()=>{const f=$('#file').files[0];$('#file-name').textContent=f?`${f.name} · ${(f.size/1024).toFixed(0)} KB`:'No file selected';if(f)readFile();});
$('#inspect-paste').onclick=readPaste;$('#analyze').onclick=analyze;
