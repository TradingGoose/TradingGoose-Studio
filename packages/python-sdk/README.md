# TradingGoose Python SDK

Repository-local preview of the TradingGoose Python client.

> **Development status:** `tradinggoose-sdk` is not currently published to PyPI. For production integrations, use the supported [Execution API](https://docs.tradinggoose.ai/execution/api).

## Install from source

```bash
git clone https://github.com/TradingGoose/TradingGoose-Studio.git
cd TradingGoose-Studio/packages/python-sdk
python3 -m venv venv
source venv/bin/activate
pip install -e .
```

## Quick Start

```python
import os
from tradinggoose import TradingGooseClient

# Initialize the client
client = TradingGooseClient(
    api_key=os.getenv("TRADINGGOOSE_API_KEY", "your-api-key-here"),
    base_url="https://www.tradinggoose.ai"  # optional
)

# Execute a workflow
try:
    result = client.execute_workflow("workflow-id")
    print("Workflow executed successfully:", result)
except Exception as error:
    print("Workflow execution failed:", error)
```

## API Reference

### TradingGooseClient

#### Constructor

```python
TradingGooseClient(api_key: str, base_url: str = "https://www.tradinggoose.ai")
```

- `api_key` (str): Your TradingGoose API key
- `base_url` (str, optional): Base URL for the TradingGoose API (defaults to `https://www.tradinggoose.ai`)

#### Methods

##### execute_workflow(workflow_id, input_data=None, timeout=30.0)

Execute a workflow with optional input data.

```python
result = client.execute_workflow(
    "workflow-id",
    input_data={"message": "Hello, world!"},
    timeout=30.0,  # seconds
)
```

**Parameters:**
- `workflow_id` (str): The ID of the workflow to execute
- `input_data` (dict, optional): Input data to pass to the workflow. File objects are automatically converted to base64.
- `timeout` (float): Timeout in seconds (default: 30.0)

**Returns:** `WorkflowExecutionResult | Dict[str, Any]`

For a workflow with a Response block, the endpoint returns the block's custom JSON body instead of `WorkflowExecutionResult`. For a successful 2xx response, the Python client returns bodies that do not match the standard execution envelope as dictionaries. It does not expose custom response headers, and a non-2xx custom status becomes `TradingGooseError`; use the direct [Execution API](https://docs.tradinggoose.ai/execution/api) when the status or headers matter.

#### Streaming

Streaming makes the API return `text/event-stream`. This preview SDK does not expose streaming or selected-output parameters because it does not implement an SSE reader. Consume the [Execution API](https://docs.tradinggoose.ai/execution/api) directly for streaming.

##### get_workflow_status(workflow_id)

Get the status of a workflow (deployment status, etc.).

```python
status = client.get_workflow_status("workflow-id")
print("Is deployed:", status.is_deployed)
```

**Parameters:**
- `workflow_id` (str): The ID of the workflow

**Returns:** `WorkflowStatus`

##### validate_workflow(workflow_id)

Validate that a workflow is ready for execution.

```python
is_ready = client.validate_workflow("workflow-id")
if is_ready:
    # Workflow is deployed and ready
    pass
```

**Parameters:**
- `workflow_id` (str): The ID of the workflow

**Returns:** `bool`

##### set_api_key(api_key)

Update the API key.

```python
client.set_api_key("new-api-key")
```

##### set_base_url(base_url)

Update the base URL.

```python
client.set_base_url("https://my-custom-domain.com")
```

##### execute_with_retry(workflow_id, input_data=None, timeout=30.0, max_retries=3, initial_delay=1.0, max_delay=30.0, backoff_multiplier=2.0)

Execute a workflow and retry only `RATE_LIMIT_EXCEEDED` responses. Defaults are 3 retries, a 1.0 second initial delay, a 30.0 second maximum delay, and a 2.0× backoff multiplier. The current workflow endpoint does not emit `Retry-After`, so retries use exponential backoff with ±25% jitter. A compatible deployment that supplies the header overrides that delay.

**Returns:** `WorkflowExecutionResponse`

```python
result = client.execute_with_retry(
    "workflow-id",
    input_data={"message": "Hello"},
    max_retries=3,
    initial_delay=1.0,
    max_delay=30.0,
    backoff_multiplier=2.0,
)
```

##### get_rate_limit_info()

Return the latest `RateLimitInfo`. The current workflow and usage endpoints do not emit rate-limit headers, so this normally remains `None`; a compatible deployment or proxy may supply them. `retry_after` is stored in milliseconds.

##### get_usage_limits()

Return a `UsageLimits` value from `/api/users/me/usage-limits`.

##### close()

Close the underlying HTTP session.

```python
client.close()
```

## Data Classes

### RateLimitInfo and UsageLimits

```python
@dataclass
class RateLimitInfo:
    limit: int
    remaining: int
    reset: str  # ISO timestamp
    retry_after: Optional[int] = None  # milliseconds

@dataclass
class UsageLimits:
    success: bool
    rate_limit: Dict[str, Any]
    usage: Dict[str, Any]
    storage: Dict[str, Any]
```

Python does not export a separate retry-options type; retry settings are keyword arguments to `execute_with_retry`.

### WorkflowExecutionResult

```python
@dataclass
class WorkflowExecutionResult:
    success: bool
    output: Any
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

WorkflowExecutionResponse = Union[WorkflowExecutionResult, Dict[str, Any]]
```

`WorkflowExecutionResult` is the normal non-streaming response for a workflow without a Response block. A successful Response block whose body does not match that standard envelope returns its custom JSON object as the dictionary branch of `WorkflowExecutionResponse`.

### WorkflowStatus

```python
@dataclass
class WorkflowStatus:
    is_deployed: bool
    deployed_at: Optional[str] = None
    needs_redeployment: bool = False
```

### TradingGooseError

```python
class TradingGooseError(Exception):
    def __init__(self, message: str, code: Optional[str] = None, status: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.status = status
```

HTTP failures preserve the API error code and status. Timeouts use `TIMEOUT`; request/execution failures use `EXECUTION_ERROR`; usage-limit failures use `USAGE_ERROR`; HTTP 429 uses `RATE_LIMIT_EXCEEDED`.

## Examples

### Basic Workflow Execution

This example assumes the workflow does not use a Response block, so the result uses the standard `WorkflowExecutionResult` envelope.

```python
import os
from tradinggoose import TradingGooseClient

client = TradingGooseClient(api_key=os.getenv("TRADINGGOOSE_API_KEY"))

def run_workflow():
    try:
        # Check if workflow is ready
        is_ready = client.validate_workflow("my-workflow-id")
        if not is_ready:
            raise Exception("Workflow is not deployed or ready")

        # Execute the workflow
        result = client.execute_workflow(
            "my-workflow-id",
            input_data={
                "message": "Process this data",
                "user_id": "12345"
            }
        )

        if result.success:
            print("Output:", result.output)
            print("Duration:", result.metadata.get("duration") if result.metadata else None)
        else:
            print("Workflow failed:", result.error)
            
    except Exception as error:
        print("Error:", error)

run_workflow()
```

### Error Handling

```python
from tradinggoose import TradingGooseClient, TradingGooseError
import os

client = TradingGooseClient(api_key=os.getenv("TRADINGGOOSE_API_KEY"))

def execute_with_error_handling():
    try:
        result = client.execute_workflow("workflow-id")
        return result
    except TradingGooseError as error:
        if error.status == 401:
            print("Invalid API key")
        elif error.code == "TIMEOUT":
            print("Workflow execution timed out")
        elif error.code == "USAGE_LIMIT_EXCEEDED":
            print("Usage limit exceeded")
        elif error.code == "INVALID_JSON_IN_REQUEST_BODY":
            print("Invalid JSON in request body")
        else:
            print(f"Workflow error: {error}")
        raise
    except Exception as error:
        print(f"Unexpected error: {error}")
        raise
```

### Context Manager Usage

```python
from tradinggoose import TradingGooseClient
import os

# Using context manager to automatically close the session
with TradingGooseClient(api_key=os.getenv("TRADINGGOOSE_API_KEY")) as client:
    result = client.execute_workflow("workflow-id")
    print("Result:", result)
# Session is automatically closed here
```

### Environment Configuration

```python
import os
from tradinggoose import TradingGooseClient

# Using environment variables
client = TradingGooseClient(
    api_key=os.getenv("TRADINGGOOSE_API_KEY"),
    base_url=os.getenv("TRADINGGOOSE_BASE_URL", "https://www.tradinggoose.ai")
)
```

### File Upload

File objects are automatically detected and converted to base64 format. Include them in your input under the field name matching your workflow's API trigger input format:

The SDK converts file objects to this format:
```python
{
  'type': 'file',
  'data': 'data:mime/type;base64,base64data',
  'name': 'filename',
  'mime': 'mime/type'
}
```

Alternatively, you can manually provide files using the URL format:
```python
{
  'type': 'url',
  'data': 'https://example.com/file.pdf',
  'name': 'file.pdf',
  'mime': 'application/pdf'
}
```

```python
from tradinggoose import TradingGooseClient
import os

client = TradingGooseClient(api_key=os.getenv("TRADINGGOOSE_API_KEY"))

# Upload a single file - include it under the field name from your API trigger
with open('document.pdf', 'rb') as f:
    result = client.execute_workflow(
        'workflow-id',
        input_data={
            'documents': [f],  # Must match your workflow's "files" field name
            'instructions': 'Analyze this document'
        }
    )

# Upload multiple files
with open('doc1.pdf', 'rb') as f1, open('doc2.pdf', 'rb') as f2:
    result = client.execute_workflow(
        'workflow-id',
        input_data={
            'attachments': [f1, f2],  # Must match your workflow's "files" field name
            'query': 'Compare these documents'
        }
    )
```

### Batch Workflow Execution

This example assumes each workflow returns the standard execution envelope rather than a custom Response-block body.

```python
from tradinggoose import TradingGooseClient
import os

client = TradingGooseClient(api_key=os.getenv("TRADINGGOOSE_API_KEY"))

def execute_workflows_batch(workflow_data_pairs):
    """Execute multiple workflows with different input data."""
    results = []

    for workflow_id, input_data in workflow_data_pairs:
        try:
            # Validate workflow before execution
            if not client.validate_workflow(workflow_id):
                print(f"Skipping {workflow_id}: not deployed")
                continue

            result = client.execute_workflow(workflow_id, input_data)
            results.append({
                "workflow_id": workflow_id,
                "success": result.success,
                "output": result.output,
                "error": result.error
            })

        except Exception as error:
            results.append({
                "workflow_id": workflow_id,
                "success": False,
                "error": str(error)
            })

    return results

# Example usage
workflows = [
    ("workflow-1", {"type": "analysis", "data": "sample1"}),
    ("workflow-2", {"type": "processing", "data": "sample2"}),
]

results = execute_workflows_batch(workflows)
for result in results:
    print(f"Workflow {result['workflow_id']}: {'Success' if result['success'] else 'Failed'}")
```

## Getting Your API Key

1. Log in to your [TradingGoose](https://www.tradinggoose.ai) account
2. Navigate to your workflow
3. Click on "Deploy" to deploy your workflow
4. Select or create an API key during the deployment process
5. Copy the API key to use in your application

## Development

### Running Tests

To run the tests locally:

1. Clone the repository and navigate to the Python SDK directory:
   ```bash
   cd packages/python-sdk
   ```

2. Create and activate a virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install the package in development mode with test dependencies:
   ```bash
   pip install -e ".[dev]"
   ```

4. Run the tests:
   ```bash
   pytest tests/ -v
   ```

### Code Quality

Run code quality checks:

```bash
# Code formatting
black tradinggoose/

# Linting
flake8 tradinggoose/ --max-line-length=100

# Type checking
mypy tradinggoose/

# Import sorting
isort tradinggoose/
```

## Requirements

- Python 3.8+
- requests >= 2.25.0

## License

AGPL-3.0-only
