# TradingGoose SDKs

This directory contains the official SDKs for [TradingGoose](https://tradinggoose.ai), allowing developers to execute workflows programmatically from their applications.

## Available SDKs

### Package Installation Commands

- **TypeScript/JavaScript**: `npm install tradinggoose-ts-sdk`
- **Python**: `pip install tradinggoose-sdk`

### 🟢 TypeScript/JavaScript SDK (`tradinggoose-ts-sdk`)

**Directory:** `ts-sdk/`

The TypeScript SDK provides type-safe workflow execution for Node.js and browser environments.

**Installation:**
```bash
npm install tradinggoose-ts-sdk
# or 
yarn add tradinggoose-ts-sdk
# or
bun add tradinggoose-ts-sdk
```

**Quick Start:**
```typescript
import { TradingGooseClient } from 'tradinggoose-ts-sdk';

const client = new TradingGooseClient({
  apiKey: 'your-api-key-here'
});

const result = await client.executeWorkflow('workflow-id', {
  input: { message: 'Hello, world!' }
});
```

### 🐍 Python SDK (`tradinggoose-sdk`)

**Directory:** `python-sdk/`

The Python SDK provides Pythonic workflow execution with comprehensive error handling and data classes.

**Installation:**
```bash
pip install tradinggoose-sdk
```

**Quick Start:**
```python
from tradinggoose import TradingGooseClient

client = TradingGooseClient(api_key='your-api-key-here')

result = client.execute_workflow('workflow-id', 
    input_data={'message': 'Hello, world!'})
```

## Core Features

Both SDKs provide the same core functionality:

✅ **Workflow Execution** - Execute deployed workflows with optional input data  
✅ **Status Checking** - Check deployment status and workflow readiness  
✅ **Error Handling** - Comprehensive error handling with specific error codes  
✅ **Timeout Support** - Configurable timeouts for workflow execution  
✅ **Input Validation** - Validate workflows before execution  
✅ **Type Safety** - Full type definitions (TypeScript) and data classes (Python)  

## API Compatibility

Both SDKs are built on top of the same REST API endpoints:

- `POST /api/workflows/{id}/execute` - Execute workflow (with or without input)
- `GET /api/workflows/{id}/status` - Get workflow status

## Authentication

Both SDKs use API key authentication via the `X-API-Key` header. You can obtain an API key by:

1. Logging in to your [TradingGoose](https://tradinggoose.ai) account
2. Navigating to your workflow
3. Clicking "Deploy" to deploy your workflow
4. Creating or selecting an API key during deployment

## Environment Variables

Both SDKs support environment variable configuration:

```bash
# Required
TRADINGGOOSE_API_KEY=your-api-key-here

# Optional
TRADINGGOOSE_BASE_URL=https://tradinggoose.ai  # or your custom domain
```

## Error Handling

Both SDKs provide consistent error handling with these error codes:

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Invalid API key |
| `TIMEOUT` | Request timed out |
| `USAGE_LIMIT_EXCEEDED` | Account usage limit exceeded |
| `INVALID_JSON` | Invalid JSON in request body |
| `EXECUTION_ERROR` | General execution error |
| `STATUS_ERROR` | Error getting workflow status |

## Examples

### TypeScript Example

```typescript
import { TradingGooseClient, TradingGooseError } from 'tradinggoose-ts-sdk';

const client = new TradingGooseClient({
  apiKey: process.env.TRADINGGOOSE_API_KEY!
});

try {
  // Check if workflow is ready
  const isReady = await client.validateWorkflow('workflow-id');
  if (!isReady) {
    throw new Error('Workflow not deployed');
  }

  // Execute workflow
  const result = await client.executeWorkflow('workflow-id', {
    input: { data: 'example' },
    timeout: 30000
  });

  if (result.success) {
    console.log('Output:', result.output);
  }
} catch (error) {
  if (error instanceof TradingGooseError) {
    console.error(`Error ${error.code}: ${error.message}`);
  }
}
```

### Python Example

```python
from tradinggoose import TradingGooseClient, TradingGooseError
import os

client = TradingGooseClient(api_key=os.getenv('TRADINGGOOSE_API_KEY'))

try:
    # Check if workflow is ready
    is_ready = client.validate_workflow('workflow-id')
    if not is_ready:
        raise Exception('Workflow not deployed')

    # Execute workflow
    result = client.execute_workflow('workflow-id', 
        input_data={'data': 'example'},
        timeout=30.0)

    if result.success:
        print(f'Output: {result.output}')
        
except TradingGooseError as error:
    print(f'Error {error.code}: {error}')
```

## Development

### Building the SDKs

**TypeScript SDK:**
```bash
cd packages/ts-sdk
bun install
bun run build
```

**Python SDK:**
```bash
cd packages/python-sdk
pip install -e ".[dev]"
python -m build
```

### Running Examples

**TypeScript:**
```bash
cd packages/ts-sdk
TRADINGGOOSE_API_KEY=your-key bun run examples/basic-usage.ts
```

**Python:**
```bash
cd packages/python-sdk
TRADINGGOOSE_API_KEY=your-key python examples/basic_usage.py
```

### Testing

**TypeScript:**
```bash
cd packages/ts-sdk
bun run test
```

**Python:**
```bash
cd packages/python-sdk
pytest
```

## Publishing

The SDKs are automatically published to npm and PyPI when changes are pushed to the main branch. See [Publishing Setup](../.github/PUBLISHING.md) for details on:

- Setting up GitHub secrets for automated publishing
- Manual publishing instructions
- Version management and semantic versioning
- Troubleshooting common issues

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Add tests for your changes
5. Run the test suite: `bun run test` (TypeScript) or `pytest` (Python)
6. Update version numbers if needed
7. Commit your changes: `git commit -m 'Add amazing feature'`
8. Push to the branch: `git push origin feature/amazing-feature`
9. Open a Pull Request

## License

Both SDKs in this repository are licensed under the AGPL-3.0-only License. See the [LICENSE](../LICENSE) file for details.

## Support

- 📖 [Documentation](https://docs.tradinggoose.ai)
- 💬 [Discord Community](https://discord.gg/tradinggoose)
- 🐛 [Issue Tracker](https://github.com/TradingGoose/TradingGoose-Studio/issues)
- 📧 [Email Support](mailto:support@tradinggoose.ai) 
