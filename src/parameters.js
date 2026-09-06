export const MODEL_GROUPS = [
  ["OpenAI / ChatGPT", [
    ["GPT-5.6 Luna", "Lite"], ["GPT-5.6 Terra", "Standard"], ["GPT-5.6 Sol", "Frontier"], ["GPT-5.6 Pro", "Frontier+"],
    ["GPT-4.1 nano", "Lite"], ["GPT-4.1 mini", "Standard"], ["GPT-4o mini", "Standard"], ["GPT-4o", "Standard"],
    ["GPT-4.1", "Frontier"], ["o1 / o3 family", "Frontier"], ["GPT-4.5", "Frontier+"]
  ]],
  ["Anthropic / Claude", [
    ["Claude Haiku 4.5", "Lite"], ["Claude Sonnet 5", "Standard"], ["Claude Opus 5", "Frontier"], ["Claude Fable 5", "Frontier+"],
    ["Claude 3/3.5 Haiku", "Lite"], ["Claude 3.5 Sonnet", "Standard"], ["Claude 3.7 Sonnet", "Frontier+"]
  ]],
  ["Google / Gemini", [
    ["Gemini 3.5 Flash-Lite", "Lite"], ["Gemini 3.8 Flash", "Standard"], ["Gemini 3.1 Pro", "Frontier"],
    ["Gemini 3.5 Flash", "Standard"], ["Gemini 3.7 Flash", "Standard"], ["Gemini 2.x/2.5 Flash", "Standard"], ["Gemini 2.5 Pro", "Frontier"]
  ]],
  ["xAI / Grok", [
    ["Grok 4.3", "Standard"], ["Grok 4.20", "Frontier"], ["Grok 4.5", "Frontier"], ["Grok 4.6", "Frontier"], ["Grok 3 / early Grok 4", "Frontier"]
  ]],
  ["DeepSeek", [
    ["DeepSeek V4 Flash", "Standard"], ["DeepSeek V4 Pro", "Frontier"], ["DeepSeek V3/V3.1", "Frontier+"], ["DeepSeek R1", "Frontier+"]
  ]],
  ["Other / unknown", [
    ["Unknown / other lightweight model", "Lite"], ["Unknown / other standard model", "Standard"], ["Unknown / other frontier model", "Frontier"]
  ]]
];

export const MODEL_CLASSES = Object.fromEntries(MODEL_GROUPS.flatMap(([, models]) => models));
export const OUTPUT_ENERGY_WH_PER_TOKEN = { Lite: 0.00015, Standard: 0.00050, Frontier: 0.00100, "Frontier+": 0.00150 };
export const OUTPUT_ENERGY_RANGE = {
  Lite: [0.00008, 0.00030], Standard: [0.00025, 0.00080], Frontier: [0.00050, 0.00150], "Frontier+": [0.00080, 0.00250]
};
export const THINKING_MULTIPLIER = { "Standard / none": 0, Low: 1, Medium: 3, High: 7, "Extra-high / Max": 14 };
export const THINKING_RANGE = { "Standard / none": [0,0], Low: [0.3,2], Medium: [1,5], High: [3,12], "Extra-high / Max": [7,25] };
export const THINKING_CHOICES = Object.keys(THINKING_MULTIPLIER);

export const TOOL_ENERGY_WH = { web: 0.04, code: 0.01, image_in: 0.06, image_out: 2.9, video: 25, document: 0 };
export const TOOL_ENERGY_RANGE_WH = { web: [0.02,0.30], code: [0.002,0.05], image_in: [0.01,0.20], image_out: [0.3,11.5], video: [0.1,110], document: [0,0] };

export const DIRECT_WATER_ML_PER_WH = 0.2;
export const ELECTRICITY_WATER_ML_PER_WH = 3.9;
export const TOTAL_WATER_ML_PER_WH = 4.1;
export const TOTAL_WATER_RANGE_ML_PER_WH = [2, 8];

export function inputRatio(tokens) {
  if (tokens <= 1000) return 0.10;
  if (tokens <= 5000) return 0.20;
  return 0.35;
}

export const REFERENCES = [
  ["Oviedo et al., Energy Use of AI Inference: Efficiency Pathways and Test-Time Compute", "https://arxiv.org/abs/2509.20241"],
  ["Jegham et al., How Hungry is AI? Benchmarking Energy, Water, and Carbon Footprint of LLM Inference", "https://arxiv.org/abs/2505.09598"],
  ["Elsworth et al., Measuring the environmental impact of AI inference", "https://arxiv.org/abs/2508.15734"],
  ["Luccioni, Jernite & Strubell, Power Hungry Processing", "https://dl.acm.org/doi/10.1145/3630106.3658542"],
  ["Delavande et al., Video Killed the Energy Budget", "https://arxiv.org/abs/2509.19222"],
  ["EcoLogits methodology", "https://ecologits.ai/latest/methodology/llm_inference/"]
];
