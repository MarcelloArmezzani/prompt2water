export const MODELS = [
  ['GPT-5.6 Luna', 'Lite'],
  ['GPT-5.6 Sol', 'Frontier'],
  ['GPT-5.6 Pro', 'Frontier+'],
  ['GPT-4o mini', 'Standard'],
  ['GPT-4o', 'Standard'],
  ['GPT-4.1', 'Frontier'],
  ['o1 / o3 family', 'Frontier'],
  ['GPT-4.5', 'Frontier+']
];

export const MODEL_CLASSES = Object.fromEntries(MODELS);
export const OUTPUT_ENERGY_WH_PER_TOKEN = { Lite: 0.00015, Standard: 0.00050, Frontier: 0.00100, 'Frontier+': 0.00150 };
export const THINKING_MULTIPLIER = { 'Standard / none': 0, Low: 1, Medium: 3, High: 7, 'Extra-high / Max': 14 };
export const THINKING_CHOICES = Object.keys(THINKING_MULTIPLIER);
export const TOOL_ENERGY_WH = { web: 0.04, code: 0.01, image_in: 0.06, image_out: 2.9, video: 25, document: 0 };
export const DIRECT_WATER_ML_PER_WH = 0.2;
export const ELECTRICITY_WATER_ML_PER_WH = 3.9;
export const TOTAL_WATER_ML_PER_WH = 4.1;

export function inputRatio(tokens) {
  if (tokens <= 1000) return 0.10;
  if (tokens <= 5000) return 0.20;
  return 0.35;
}
