import {
  MODEL_CLASSES, OUTPUT_ENERGY_WH_PER_TOKEN, OUTPUT_ENERGY_RANGE,
  THINKING_MULTIPLIER, THINKING_RANGE, TOOL_ENERGY_WH, TOOL_ENERGY_RANGE_WH,
  DIRECT_WATER_ML_PER_WH, ELECTRICITY_WATER_ML_PER_WH, TOTAL_WATER_ML_PER_WH,
  TOTAL_WATER_RANGE_ML_PER_WH, inputRatio
} from './parameters.js';

export function toolCounts(initial={}) {
  return { web:0, code:0, image_in:0, image_out:0, video:0, document:0, ...initial };
}
export function addTools(a, b) {
  const x=toolCounts(a), y=toolCounts(b);
  return Object.fromEntries(Object.keys(x).map(k => [k, (x[k]||0)+(y[k]||0)]));
}

const CODE_BLOCK = /```[\s\S]*?```/g;
export function countTokens(text='') {
  if (!text) return 0;
  let codeChars=0;
  for (const m of text.matchAll(CODE_BLOCK)) codeChars += m[0].length;
  const proseChars=Math.max(0, text.length-codeChars);
  let n=proseChars/4 + codeChars/3;
  let nonAscii=0;
  for (const ch of text) if (ch.codePointAt(0)>127) nonAscii++;
  n += nonAscii*0.15;
  return Math.max(1, Math.ceil(n));
}

export function estimateConversation(conv, model, thinking) {
  const modelClass=MODEL_CLASSES[model] || 'Standard';
  const eout=OUTPUT_ENERGY_WH_PER_TOKEN[modelClass];
  const [eoutLow,eoutHigh]=OUTPUT_ENERGY_RANGE[modelClass];
  const r=THINKING_MULTIPLIER[thinking] ?? 0;
  const [rLow,rHigh]=THINKING_RANGE[thinking] || [0,0];
  const visibleHistory=[];
  const turns=[];
  let lastUser=''; let lastUserTools=toolCounts();
  let totalInput=0,totalOutput=0,textEnergy=0,toolEnergy=0,lowE=0,highE=0;
  let allTools=toolCounts(); let turnNo=0;
  for (const msg of conv.messages || []) {
    if (msg.role==='user') {
      visibleHistory.push(msg.text || '');
      lastUser=msg.text || '';
      lastUserTools=toolCounts(msg.tools);
      continue;
    }
    if (msg.role!=='assistant') continue;
    turnNo++;
    const nIn=countTokens(visibleHistory.join('\n'));
    const nOut=countTokens(msg.text || '');
    const ratio=inputRatio(nIn);
    const textE=eout*ratio*nIn + eout*(1+r)*nOut;
    const msgTools=toolCounts(msg.tools);
    const tools=addTools(msgTools,{image_in:lastUserTools.image_in,document:lastUserTools.document});
    const toolE=tools.web*TOOL_ENERGY_WH.web + tools.code*TOOL_ENERGY_WH.code + tools.image_in*TOOL_ENERGY_WH.image_in + tools.image_out*TOOL_ENERGY_WH.image_out + tools.video*TOOL_ENERGY_WH.video;
    const lowText=eoutLow*ratio*nIn + eoutLow*(1+rLow)*nOut;
    const highText=eoutHigh*ratio*nIn + eoutHigh*(1+rHigh)*nOut;
    const lowTool=tools.web*TOOL_ENERGY_RANGE_WH.web[0]+tools.code*TOOL_ENERGY_RANGE_WH.code[0]+tools.image_in*TOOL_ENERGY_RANGE_WH.image_in[0]+tools.image_out*TOOL_ENERGY_RANGE_WH.image_out[0]+tools.video*TOOL_ENERGY_RANGE_WH.video[0];
    const highTool=tools.web*TOOL_ENERGY_RANGE_WH.web[1]+tools.code*TOOL_ENERGY_RANGE_WH.code[1]+tools.image_in*TOOL_ENERGY_RANGE_WH.image_in[1]+tools.image_out*TOOL_ENERGY_RANGE_WH.image_out[1]+tools.video*TOOL_ENERGY_RANGE_WH.video[1];
    lowE += lowText+lowTool; highE += highText+highTool;
    const energy=textE+toolE;
    turns.push({
      turn:turnNo, user_excerpt:lastUser.replace(/\s+/g,' ').slice(0,90), input_tokens:nIn, output_tokens:nOut,
      input_ratio:ratio, reasoning_multiplier:r, text_energy_wh:textE, tool_energy_wh:toolE, total_energy_wh:energy,
      direct_water_ml:energy*DIRECT_WATER_ML_PER_WH, electricity_water_ml:energy*ELECTRICITY_WATER_ML_PER_WH,
      total_water_ml:energy*TOTAL_WATER_ML_PER_WH, tools
    });
    totalInput+=nIn; totalOutput+=nOut; textEnergy+=textE; toolEnergy+=toolE; allTools=addTools(allTools,tools);
    visibleHistory.push(msg.text || '');
  }
  const totalEnergy=textEnergy+toolEnergy;
  const direct=totalEnergy*DIRECT_WATER_ML_PER_WH;
  const electricity=totalEnergy*ELECTRICITY_WATER_ML_PER_WH;
  const warnings=[...(conv.warnings||[])];
  if (allTools.document) warnings.push('Document upload detected: document-ingestion energy is intentionally not separately quantified.');
  if (!turnNo) warnings.push('No assistant responses were recognized. Try an export or pasted transcript with User:/Assistant: labels.');
  return {
    version:'1.0-static', provider:conv.provider, title:conv.title, source_format:conv.source_format,
    model, model_class:modelClass, thinking, token_method:'offline visible-text approximation', turns,
    total_input_tokens:totalInput,total_output_tokens:totalOutput,total_energy_wh:totalEnergy,text_energy_wh:textEnergy,tool_energy_wh:toolEnergy,
    direct_water_ml:direct,electricity_water_ml:electricity,total_water_ml:direct+electricity,
    scenario_low_ml:lowE*TOTAL_WATER_RANGE_ML_PER_WH[0],scenario_high_ml:highE*TOTAL_WATER_RANGE_ML_PER_WH[1],tools:allTools,warnings,
    assumptions:[
      'Only visible user/assistant chat content is used; hidden system/developer prompts, cache hits, internal retries and invisible tools are excluded.',
      'The user supplies the model and thinking level; model labels are mapped to broad literature-calibrated energy classes.',
      'Visible context is reconstructed for every assistant turn; the browser uses a provider-independent token approximation.',
      'Thinking level is represented by a literature-motivated hidden-token multiplier, not observed chain-of-thought tokens.',
      'Uploaded documents receive no fixed processing surcharge; only visible text and explicitly detectable operations contribute.',
      'Water factors are location-independent operational averages; training, manufacturing and embodied infrastructure water are excluded.'
    ]
  };
}
