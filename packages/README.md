# TradingGoose SDKs

This directory contains repository-local preview clients for executing deployed TradingGoose workflows. Neither SDK is currently published to a package registry. For production integrations, use the supported [Execution API](https://docs.tradinggoose.ai/execution/api).

## Clients

- [TypeScript/JavaScript](./ts-sdk/README.md): Node.js client in `packages/ts-sdk`
- [Python](./python-sdk/README.md): synchronous client in `packages/python-sdk`

Both clients provide workflow execution and status checks, API-key authentication, configurable timeouts, retries for rate-limit responses, and usage-limit queries. The Python client automatically converts file inputs; the TypeScript client does so on Node.js 20+, while older Node.js versions can send manually encoded files. Neither client consumes streaming responses; use the Execution API directly for server-sent events.

## Develop locally

Install repository dependencies before building or testing the TypeScript package:

```bash
bun install
bun run --cwd packages/ts-sdk build
bun run --cwd packages/ts-sdk test
```

Install and test the Python package from its directory:

```bash
cd packages/python-sdk
python3 -m venv venv
source venv/bin/activate
pip install -e ".[dev]"
pytest
```

Both clients require an API key. Pass `TRADINGGOOSE_API_KEY` from your application environment to the client constructor. The default API base URL is `https://www.tradinggoose.ai`; pass a different base URL when using a self-hosted deployment.

## License

These packages use the repository's AGPL-3.0-only license. See [LICENSE](../LICENSE).
