import { OUTPUT_ENERGY_WH_PER_TOKEN, MODEL_CLASSES, THINKING_MULTIPLIER, TOOL_ENERGY_WH, DIRECT_WATER_ML_PER_WH, ELECTRICITY_WATER_ML_PER_WH, TOTAL_WATER_ML_PER_WH, inputRatio } from './parameters.js';

export function countTokens(text='') {
  if (!text) return 0;
  const tokenizer = globalThis.GPTTokenizer_o200k_base;
  if (tokenizer?.encode) {
    try { return tokenizer.encode(String(text)).length; } catch {}
  }
  const s=String(text);let n=s.length/4,nonAscii=0;
  for(const ch of s)if((ch.codePointAt(0)||0)>127)nonAscii++;
  n+=nonAscii*0.15;
  return Math.max(1,Math.ceil(n));
}

export function estimateConversation(conversation,model,thinking){
  const modelClass=MODEL_CLASSES[model]||'Standard';
  const eout=OUTPUT_ENERGY_WH_PER_TOKEN[modelClass];
  const r=THINKING_MULTIPLIER[thinking]??0;
  const history=[];
  let totalInputTokens=0,totalOutputTokens=0,totalReasoningTokens=0,totalToolEnergy=0,totalTextEnergy=0;
  const activity={tool_calls:0,web:0,code:0,image_in:0,image_out:0,video:0,document_out:0,document_in:0};

  for(const turn of conversation.turns||[]){
    const userText=turn.userText||'',assistantText=turn.assistantText||'';
    const visibleInput=[...history,userText].filter(Boolean).join('\n\n');
    const nIn=countTokens(visibleInput),nOut=countTokens(assistantText),reasoningTokens=r*nOut;
    const textEnergy=eout*inputRatio(nIn)*nIn+eout*(1+r)*nOut;
    const toolEnergy=(turn.web||0)*TOOL_ENERGY_WH.web+(turn.code||0)*TOOL_ENERGY_WH.code+(turn.uploadedImages||0)*TOOL_ENERGY_WH.image_in+(turn.generatedImages||0)*TOOL_ENERGY_WH.image_out+(turn.generatedVideos||0)*TOOL_ENERGY_WH.video;
    totalInputTokens+=nIn;totalOutputTokens+=nOut;totalReasoningTokens+=reasoningTokens;totalTextEnergy+=textEnergy;totalToolEnergy+=toolEnergy;
    activity.tool_calls+=turn.toolCalls||0;activity.web+=turn.web||0;activity.code+=turn.code||0;activity.image_in+=turn.uploadedImages||0;activity.image_out+=turn.generatedImages||0;activity.video+=turn.generatedVideos||0;activity.document_in+=turn.uploadedDocuments||0;activity.document_out+=turn.generatedDocuments||0;
    if(userText)history.push(userText);if(assistantText)history.push(assistantText);
  }

  const toolEquivalentTokens=totalToolEnergy/eout;
  const effectiveTokens=totalInputTokens+totalOutputTokens+totalReasoningTokens+toolEquivalentTokens;
  const totalEnergyWh=totalTextEnergy+totalToolEnergy;
  const directWaterMl=totalEnergyWh*DIRECT_WATER_ML_PER_WH;
  const electricityWaterMl=totalEnergyWh*ELECTRICITY_WATER_ML_PER_WH;
  return {
    title:conversation.title,model,modelClass,thinking,turns:(conversation.turns||[]).length,
    visibleInputTokens:Math.round(totalInputTokens),visibleOutputTokens:Math.round(totalOutputTokens),reasoningTokens:Math.round(totalReasoningTokens),toolEquivalentTokens:Math.round(toolEquivalentTokens),effectiveTokens:Math.round(effectiveTokens),
    energyWh:totalEnergyWh,directWaterMl,electricityWaterMl,totalWaterMl:totalEnergyWh*TOTAL_WATER_ML_PER_WH,activity
  };
}
