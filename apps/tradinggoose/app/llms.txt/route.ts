export async function GET() {
  const llmsContent = `# TradingGoose - Visual Workflow Platform for Technical LLM Trading

TradingGoose is an open-source visual workflow platform built for technical LLM-driven trading.
It lets you connect your own market data providers, write custom indicators in PineTS, monitor
live prices, and route signals into AI agent workflows that trigger trades, alerts, portfolio
rebalances, or any action you define.

TradingGoose Studio is the open-source core. Source code is on GitHub, self-hosting is supported,
and the hosted edition at tradinggoose.ai offers Community (free), Pro ($20/mo), Team ($40/mo),
and Enterprise tiers.

## What it is
- Visual workflow canvas for trading strategies (drag-and-drop blocks and tools)
- Widget-based workspace with split panels and saved layouts
- Custom indicator editor using PineTS; built-in indicators include RSI, Bollinger Bands, Supertrend
- Live market monitors that watch indicators at configurable intervals and fire triggers
- Integrations with LLM providers: OpenAI, Anthropic Claude, Google Gemini, xAI Grok, Mistral, Perplexity, Ollama
- Backtesting against historical candle data

## What it is not
- It is not a broker or an investment advisor
- It does not provide financial advice
- It does not execute trades on its own; you bring your own provider credentials and define every action
- It is not a generic enterprise workflow builder; it is focused on market data and trading automations

## Primary use cases
- Signal-driven trade execution: trigger a workflow when RSI crosses a threshold or a custom indicator fires
- Automated portfolio rebalancing based on market conditions
- Multi-source sentiment and market analysis combined into a single AI agent decision
- Indicator alerting into Slack, Discord, email, or any webhook
- Strategy prototyping and backtesting against historical candles
- Custom dashboards that combine charts, indicators, and live order flow in one workspace

## Key concepts
- Listing: a symbol (ticker + venue) you track
- Indicator: a built-in or custom PineTS function that computes a signal from price data
- Monitor: a rule that watches an indicator on a listing at a chosen interval and fires on signals
- Workflow: a graph of blocks and AI agents that runs when a monitor triggers
- Widget: a composable workspace panel (chart, indicator view, workflow status, etc.)

## Getting started
- Homepage: https://tradinggoose.ai
- Documentation: https://docs.tradinggoose.ai
- GitHub (open source): https://github.com/TradingGoose/TradingGoose-Studio
- Sign up (hosted): https://tradinggoose.ai/signup
- Changelog: https://tradinggoose.ai/changelog

## Community
- GitHub: https://github.com/TradingGoose/TradingGoose-Studio
- Discord: https://discord.gg/wavf5JWhuT
- X / Twitter: https://x.com/tradinggoose

## License
See https://tradinggoose.ai/licenses for license and third-party notices.

## Full reference
For a deeper, AI-readable reference (features, pricing tiers, FAQ, example
workflow, integrations, glossary), see https://tradinggoose.ai/llms-full.txt
`

  return new Response(llmsContent, {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
