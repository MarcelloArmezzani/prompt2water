# Prompt2Water

Prompt2Water is a privacy-preserving, browser-only estimator of the operational water footprint of visible LLM conversations.

The user imports a conversation from ChatGPT, Claude, Gemini, Grok or DeepSeek, selects the model and thinking level, and the estimator reconstructs visible context, output tokens and visible tool use. No chat content is sent to a backend.

The site is intended as the user-facing computational component of an environmental-sustainability report on the water footprint of artificial intelligence.

## Privacy

All parsing and estimation run locally in the browser. The deployed page does not require a login, API key, server, database, analytics service or external inference API.

## Scope

The headline value is an educational estimate of **operational water consumption**, not a provider disclosure or a physical meter. Training, semiconductor manufacturing, embodied infrastructure, hidden provider-side operations, exact server location and exact hardware are outside the estimator boundary.
