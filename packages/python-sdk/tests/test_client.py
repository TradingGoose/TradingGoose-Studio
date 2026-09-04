"""
Tests for the TradingGoose Python SDK
"""

import pytest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from unittest.mock import Mock, patch
from tradinggoose import (
    TradingGooseClient,
    TradingGooseError,
    WorkflowExecutionResult,
    WorkflowStatus,
    _parse_retry_after,
)


def test_tradinggoose_client_initialization():
    """Test TradingGooseClient initialization."""
    client = TradingGooseClient(api_key="test-api-key", base_url="https://test.tradinggoose.ai")
    assert client.api_key == "test-api-key"
    assert client.base_url == "https://test.tradinggoose.ai"


def test_tradinggoose_client_default_base_url():
    """Test TradingGooseClient with default base URL."""
    client = TradingGooseClient(api_key="test-api-key")
    assert client.api_key == "test-api-key"
    assert client.base_url == "https://www.tradinggoose.ai"


def test_set_api_key():
    """Test setting a new API key."""
    client = TradingGooseClient(api_key="test-api-key")
    client.set_api_key("new-api-key")
    assert client.api_key == "new-api-key"


def test_set_base_url():
    """Test setting a new base URL."""
    client = TradingGooseClient(api_key="test-api-key")
    client.set_base_url("https://new.tradinggoose.ai/")
    assert client.base_url == "https://new.tradinggoose.ai"


def test_set_base_url_strips_trailing_slash():
    """Test that base URL strips trailing slash."""
    client = TradingGooseClient(api_key="test-api-key")
    client.set_base_url("https://test.tradinggoose.ai/")
    assert client.base_url == "https://test.tradinggoose.ai"


@patch('tradinggoose.requests.Session.get')
def test_validate_workflow_returns_false_on_error(mock_get):
    """Test that validate_workflow returns False when request fails."""
    mock_get.side_effect = TradingGooseError("Network error")
    
    client = TradingGooseClient(api_key="test-api-key")
    result = client.validate_workflow("test-workflow-id")
    
    assert result is False
    mock_get.assert_called_once_with(
        "https://www.tradinggoose.ai/api/workflows/test-workflow-id/status",
        allow_redirects=False,
    )


def test_tradinggoose_error():
    """Test TradingGooseError creation."""
    error = TradingGooseError("Test error", "TEST_CODE", 400)
    assert str(error) == "Test error"
    assert error.code == "TEST_CODE"
    assert error.status == 400


def test_workflow_execution_result():
    """Test WorkflowExecutionResult data class."""
    result = WorkflowExecutionResult(
        success=True,
        output={"data": "test"},
        metadata={"duration": 1000}
    )
    assert result.success is True
    assert result.output == {"data": "test"}
    assert result.metadata == {"duration": 1000}


def test_workflow_status():
    """Test WorkflowStatus data class."""
    status = WorkflowStatus(
        is_deployed=True,
        deployed_at="2023-01-01T00:00:00Z",
        needs_redeployment=False
    )
    assert status.is_deployed is True
    assert status.deployed_at == "2023-01-01T00:00:00Z"
    assert status.needs_redeployment is False


@patch('tradinggoose.requests.Session.close')
def test_context_manager(mock_close):
    """Test TradingGooseClient as context manager."""
    with TradingGooseClient(api_key="test-api-key") as client:
        assert client.api_key == "test-api-key"
    # Should close without error
    mock_close.assert_called_once()


@patch('tradinggoose.requests.Session.post')
def test_sync_execution_returns_result(mock_post):
    """Test sync execution returns WorkflowExecutionResult."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "output": {"result": "completed"}
    }
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = TradingGooseClient(api_key="test-api-key")
    result = client.execute_workflow(
        "workflow-id",
        input_data={"message": "Hello"},
    )

    assert result.success is True
    assert result.output == {"result": "completed"}
    assert not hasattr(result, 'task_id')
    _, kwargs = mock_post.call_args
    assert kwargs["json"] == {"input": {"message": "Hello"}}
    assert kwargs["allow_redirects"] is False


@patch('tradinggoose.requests.Session.post')
def test_workflow_fields_stay_inside_input_envelope(mock_post):
    """Workflow fields cannot collide with API control fields."""
    mock_response = Mock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"success": True, "output": {}}
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response
    input_data = {
        "input": "workflow input field",
        "stream": "workflow stream field",
        "selectedOutputs": ["workflow output field"],
    }

    TradingGooseClient(api_key="test-api-key").execute_workflow(
        "workflow-id", input_data=input_data
    )

    assert mock_post.call_args.kwargs["json"] == {"input": input_data}


@patch('tradinggoose.requests.Session.post')
def test_execute_does_not_follow_response_block_redirects(mock_post):
    """Response-block redirects must not forward the API key."""
    mock_response = Mock()
    mock_response.status_code = 302
    mock_response.reason = "Found"
    mock_response.json.side_effect = ValueError
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    with pytest.raises(TradingGooseError) as exc_info:
        TradingGooseClient(api_key="secret-key").execute_workflow("workflow-id")

    assert exc_info.value.status == 302
    assert mock_post.call_count == 1
    assert mock_post.call_args.kwargs["allow_redirects"] is False


@patch('tradinggoose.requests.Session.post')
def test_response_block_body_is_returned(mock_post):
    """Test that a successful custom Response-block body is returned unchanged."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {"message": "accepted"}
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = TradingGooseClient(api_key="test-api-key")

    result = client.execute_workflow("workflow-id")

    assert result == {"message": "accepted"}


@patch('tradinggoose.requests.Session.post')
def test_response_block_body_with_execution_keys_is_preserved(mock_post):
    """Test that extra custom fields prevent response-envelope normalization."""
    custom_body = {
        "success": True,
        "output": {"id": 7},
        "custom": "preserve-me",
    }
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = custom_body
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = TradingGooseClient(api_key="test-api-key")

    result = client.execute_workflow("workflow-id")

    assert result == custom_body


# Tests for retry with rate limiting
@patch('tradinggoose.requests.Session.post')
@patch('tradinggoose.time.sleep')
def test_execute_with_retry_success_first_attempt(mock_sleep, mock_post):
    """Test retry succeeds on first attempt."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "output": {"result": "success"}
    }
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = TradingGooseClient(api_key="test-api-key")
    result = client.execute_with_retry("workflow-id", input_data={"message": "test"})

    assert result.success is True
    assert mock_post.call_count == 1
    assert mock_sleep.call_count == 0


@patch('tradinggoose.requests.Session.post')
@patch('tradinggoose.time.sleep')
def test_execute_with_retry_retries_on_rate_limit(mock_sleep, mock_post):
    """Test retry retries on rate limit error."""
    rate_limit_response = Mock()
    rate_limit_response.ok = False
    rate_limit_response.status_code = 429
    rate_limit_response.json.return_value = {
        "error": "Rate limit exceeded",
        "code": "RATE_LIMIT_EXCEEDED"
    }
    rate_limit_response.headers.get.side_effect = lambda h: {
        'retry-after': '1',
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '2026-09-03T18:31:00.000Z'
    }.get(h)

    success_response = Mock()
    success_response.ok = True
    success_response.status_code = 200
    success_response.json.return_value = {
        "success": True,
        "output": {"result": "success"}
    }
    success_response.headers.get.return_value = None

    mock_post.side_effect = [rate_limit_response, success_response]

    client = TradingGooseClient(api_key="test-api-key")
    with patch('tradinggoose.random.random', return_value=0.0):
        result = client.execute_with_retry(
            "workflow-id",
            input_data={"message": "test"},
            max_retries=3,
            initial_delay=0.01
        )

    assert result.success is True
    assert mock_post.call_count == 2
    mock_sleep.assert_called_once_with(1.0)


@patch('tradinggoose.requests.Session.post')
@patch('tradinggoose.time.sleep')
def test_execute_with_retry_max_retries_exceeded(mock_sleep, mock_post):
    """Test retry throws after max retries."""
    mock_response = Mock()
    mock_response.ok = False
    mock_response.status_code = 429
    mock_response.json.return_value = {
        "error": "Rate limit exceeded",
        "code": "RATE_LIMIT_EXCEEDED"
    }
    mock_response.headers.get.side_effect = lambda h: '1' if h == 'retry-after' else None
    mock_post.return_value = mock_response

    client = TradingGooseClient(api_key="test-api-key")

    with pytest.raises(TradingGooseError) as exc_info:
        client.execute_with_retry(
            "workflow-id",
            input_data={"message": "test"},
            max_retries=2,
            initial_delay=0.01
        )

    assert "Rate limit exceeded" in str(exc_info.value)
    assert mock_post.call_count == 3  # Initial + 2 retries
    assert client.get_rate_limit_info().retry_after == 1000


@patch('tradinggoose.requests.Session.post')
def test_execute_with_retry_no_retry_on_other_errors(mock_post):
    """Test retry does not retry on non-rate-limit errors."""
    mock_response = Mock()
    mock_response.ok = False
    mock_response.status_code = 500
    mock_response.reason = "Internal Server Error"
    mock_response.json.return_value = {
        "error": "Server error",
        "code": "INTERNAL_ERROR"
    }
    mock_response.headers.get.return_value = None
    mock_post.return_value = mock_response

    client = TradingGooseClient(api_key="test-api-key")

    with pytest.raises(TradingGooseError) as exc_info:
        client.execute_with_retry("workflow-id", input_data={"message": "test"})

    assert "Server error" in str(exc_info.value)
    assert mock_post.call_count == 1  # No retries


# Tests for rate limit info
def test_get_rate_limit_info_returns_none_initially():
    """Test rate limit info is None before any API calls."""
    client = TradingGooseClient(api_key="test-api-key")
    info = client.get_rate_limit_info()
    assert info is None


def test_parse_retry_after_handles_zero_http_date_and_invalid_values():
    """Retry-After supports delay-seconds and HTTP-date without parser failures."""
    assert _parse_retry_after("0") == 0
    future = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=2), usegmt=True)
    parsed_date = _parse_retry_after(future)
    assert parsed_date is not None
    assert 0 <= parsed_date <= 2000
    assert _parse_retry_after("invalid") is None


@patch('tradinggoose.requests.Session.post')
def test_get_rate_limit_info_after_api_call(mock_post):
    """Test rate limit info is populated after API call."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {"success": True, "output": {}}
    mock_response.headers.get.side_effect = lambda h: {
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '95',
        'x-ratelimit-reset': '2026-09-03T18:31:00.000Z'
    }.get(h)
    mock_post.return_value = mock_response

    client = TradingGooseClient(api_key="test-api-key")
    client.execute_workflow("workflow-id", input_data={})

    info = client.get_rate_limit_info()
    assert info is not None
    assert info.limit == 100
    assert info.remaining == 95
    assert info.reset == '2026-09-03T18:31:00.000Z'


# Tests for usage limits
@patch('tradinggoose.requests.Session.get')
def test_get_usage_limits_success(mock_get):
    """Test getting usage limits."""
    mock_response = Mock()
    mock_response.ok = True
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "success": True,
        "rateLimit": {
            "sync": {
                "isLimited": False,
                "limit": 100,
                "remaining": 95,
                "resetAt": "2024-01-01T01:00:00Z"
            },
            "async": {
                "isLimited": False,
                "limit": 50,
                "remaining": 48,
                "resetAt": "2024-01-01T01:00:00Z"
            },
            "authType": "api"
        },
        "usage": {
            "currentPeriodCost": 1.23,
            "limit": 100.0,
            "tier": {"id": "tier-pro", "displayName": "Pro"}
        },
        "storage": {
            "usedBytes": 1000,
            "limitBytes": 10000,
            "percentUsed": 10
        }
    }
    mock_response.headers.get.return_value = None
    mock_get.return_value = mock_response

    client = TradingGooseClient(api_key="test-api-key", base_url="https://test.tradinggoose.ai")
    result = client.get_usage_limits()

    assert result.success is True
    assert result.rate_limit["sync"]["limit"] == 100
    assert result.rate_limit["async"]["limit"] == 50
    assert result.usage["currentPeriodCost"] == 1.23
    assert result.usage["tier"] == {"id": "tier-pro", "displayName": "Pro"}
    assert result.storage["usedBytes"] == 1000
    assert result.storage["limitBytes"] == 10000
    assert result.storage["percentUsed"] == 10
    mock_get.assert_called_once_with(
        "https://test.tradinggoose.ai/api/users/me/usage-limits", allow_redirects=False
    )


@patch('tradinggoose.requests.Session.get')
def test_get_usage_limits_unauthorized(mock_get):
    """Test usage limits with invalid API key."""
    mock_response = Mock()
    mock_response.ok = False
    mock_response.status_code = 401
    mock_response.reason = "Unauthorized"
    mock_response.json.return_value = {
        "error": "Invalid API key",
        "code": "UNAUTHORIZED"
    }
    mock_response.headers.get.return_value = None
    mock_get.return_value = mock_response

    client = TradingGooseClient(api_key="invalid-key")

    with pytest.raises(TradingGooseError) as exc_info:
        client.get_usage_limits()
    assert "Invalid API key" in str(exc_info.value)
