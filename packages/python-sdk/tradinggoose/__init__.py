"""
TradingGoose SDK for Python

Repository-local preview client for executing TradingGoose workflows programmatically.
"""

from typing import Any, Dict, Optional, Union
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import time
import random
import os

import requests


__version__ = "0.1.0"
_WORKFLOW_EXECUTION_RESULT_KEYS = frozenset({"success", "output", "error", "metadata"})
__all__ = [
    "TradingGooseClient",
    "TradingGooseError",
    "WorkflowExecutionResult",
    "WorkflowExecutionResponse",
    "WorkflowStatus",
    "RateLimitInfo",
    "UsageLimits",
]


def _parse_retry_after(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None

    try:
        seconds = int(value)
        return seconds * 1000 if seconds >= 0 else None
    except ValueError:
        pass

    try:
        retry_at = parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if retry_at.tzinfo is None:
        retry_at = retry_at.replace(tzinfo=timezone.utc)
    return max(0, int((retry_at - datetime.now(timezone.utc)).total_seconds() * 1000))


@dataclass
class WorkflowExecutionResult:
    """Result of a workflow execution."""
    success: bool
    output: Any
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


WorkflowExecutionResponse = Union[WorkflowExecutionResult, Dict[str, Any]]


@dataclass
class WorkflowStatus:
    """Status of a workflow."""
    is_deployed: bool
    deployed_at: Optional[str] = None
    needs_redeployment: bool = False


@dataclass
class RateLimitInfo:
    """Rate limit information from API response headers."""
    limit: int
    remaining: int
    reset: str
    retry_after: Optional[int] = None


@dataclass
class UsageLimits:
    """Usage limits and quota information."""
    success: bool
    rate_limit: Dict[str, Any]
    usage: Dict[str, Any]
    storage: Dict[str, Any]


class TradingGooseError(Exception):
    """Exception raised for TradingGoose API errors."""
    
    def __init__(self, message: str, code: Optional[str] = None, status: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.status = status


class TradingGooseClient:
    """
    TradingGoose API client for executing workflows programmatically.
    
    Args:
        api_key: Your TradingGoose API key
        base_url: Base URL for the TradingGoose API (defaults to https://www.tradinggoose.ai)
    """
    
    def __init__(self, api_key: str, base_url: str = "https://www.tradinggoose.ai"):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self._session = requests.Session()
        self._session.headers.update({
            'X-API-Key': self.api_key,
            'Content-Type': 'application/json',
        })
        self._rate_limit_info: Optional[RateLimitInfo] = None
    
    def _convert_files_to_base64(self, value: Any) -> Any:
        """
        Convert file objects in input to API format (base64).
        Recursively processes nested dicts and lists.
        """
        import base64
        import io

        # Check if this is a file-like object
        if hasattr(value, 'read') and callable(value.read):
            # Save current position if seekable
            initial_pos = value.tell() if hasattr(value, 'tell') else None

            # Read file bytes
            file_bytes = value.read()

            # Restore position if seekable
            if initial_pos is not None and hasattr(value, 'seek'):
                value.seek(initial_pos)

            # Encode to base64
            base64_data = base64.b64encode(file_bytes).decode('utf-8')

            # Get file metadata
            filename = getattr(value, 'name', 'file')
            if isinstance(filename, str):
                filename = os.path.basename(filename)

            content_type = getattr(value, 'content_type', 'application/octet-stream')

            return {
                'type': 'file',
                'data': f'data:{content_type};base64,{base64_data}',
                'name': filename,
                'mime': content_type
            }

        # Recursively process lists
        if isinstance(value, list):
            return [self._convert_files_to_base64(item) for item in value]

        # Recursively process dicts
        if isinstance(value, dict):
            return {k: self._convert_files_to_base64(v) for k, v in value.items()}

        return value

    def execute_workflow(
        self,
        workflow_id: str,
        input_data: Optional[Dict[str, Any]] = None,
        timeout: float = 30.0
    ) -> WorkflowExecutionResponse:
        """
        Execute a workflow with optional input data.

        File objects in input_data will be automatically detected and converted to base64.

        Args:
            workflow_id: The ID of the workflow to execute
            input_data: Input data to pass to the workflow (can include file-like objects)
            timeout: Timeout in seconds (default: 30.0)

        Returns:
            WorkflowExecutionResult for a standard workflow, or the custom JSON object from a
            successful Response block

        Raises:
            TradingGooseError: If the workflow execution fails
        """
        url = f"{self.base_url}/api/workflows/{workflow_id}/execute"

        headers = self._session.headers.copy()

        try:
            # Convert any file objects in the input to base64 format
            converted_input = self._convert_files_to_base64(input_data or {})

            response = self._session.post(
                url,
                json={'input': converted_input},
                headers=headers,
                timeout=timeout,
                allow_redirects=False,
            )

            # Update rate limit info
            self._update_rate_limit_info(response)

            # Handle rate limiting
            if response.status_code == 429:
                retry_after = (
                    self._rate_limit_info.retry_after
                    if self._rate_limit_info and self._rate_limit_info.retry_after is not None
                    else 1000
                )
                raise TradingGooseError(
                    f'Rate limit exceeded. Retry after {retry_after}ms',
                    'RATE_LIMIT_EXCEEDED',
                    429
                )

            if not 200 <= response.status_code < 300:
                try:
                    error_data = response.json()
                    error_message = error_data.get('error', f'HTTP {response.status_code}: {response.reason}')
                    error_code = error_data.get('code')
                except (ValueError, KeyError):
                    error_message = f'HTTP {response.status_code}: {response.reason}'
                    error_code = None

                raise TradingGooseError(error_message, error_code, response.status_code)

            result_data = response.json()

            if (
                isinstance(result_data, dict)
                and isinstance(result_data.get('success'), bool)
                and 'output' in result_data
                and set(result_data).issubset(_WORKFLOW_EXECUTION_RESULT_KEYS)
            ):
                return WorkflowExecutionResult(
                    success=result_data['success'],
                    output=result_data['output'],
                    error=result_data.get('error'),
                    metadata=result_data.get('metadata')
                )

            return result_data

        except requests.Timeout:
            raise TradingGooseError(f'Workflow execution timed out after {timeout} seconds', 'TIMEOUT')
        except requests.RequestException as e:
            raise TradingGooseError(f'Failed to execute workflow: {str(e)}', 'EXECUTION_ERROR')
    
    def get_workflow_status(self, workflow_id: str) -> WorkflowStatus:
        """
        Get the status of a workflow (deployment status, etc.).
        
        Args:
            workflow_id: The ID of the workflow
            
        Returns:
            WorkflowStatus object containing the workflow status
            
        Raises:
            TradingGooseError: If getting the status fails
        """
        url = f"{self.base_url}/api/workflows/{workflow_id}/status"
        
        try:
            response = self._session.get(url, allow_redirects=False)

            if not 200 <= response.status_code < 300:
                try:
                    error_data = response.json()
                    error_message = error_data.get('error', f'HTTP {response.status_code}: {response.reason}')
                    error_code = error_data.get('code')
                except (ValueError, KeyError):
                    error_message = f'HTTP {response.status_code}: {response.reason}'
                    error_code = None
                
                raise TradingGooseError(error_message, error_code, response.status_code)
            
            status_data = response.json()
            
            return WorkflowStatus(
                is_deployed=status_data.get('isDeployed', False),
                deployed_at=status_data.get('deployedAt'),
                needs_redeployment=status_data.get('needsRedeployment', False)
            )
            
        except requests.RequestException as e:
            raise TradingGooseError(f'Failed to get workflow status: {str(e)}', 'STATUS_ERROR')
    
    def validate_workflow(self, workflow_id: str) -> bool:
        """
        Validate that a workflow is ready for execution.
        
        Args:
            workflow_id: The ID of the workflow
            
        Returns:
            True if the workflow is deployed and ready, False otherwise
        """
        try:
            status = self.get_workflow_status(workflow_id)
            return status.is_deployed
        except TradingGooseError:
            return False
    
    def set_api_key(self, api_key: str) -> None:
        """
        Update the API key.
        
        Args:
            api_key: New API key
        """
        self.api_key = api_key
        self._session.headers.update({'X-API-Key': api_key})
    
    def set_base_url(self, base_url: str) -> None:
        """
        Update the base URL.
        
        Args:
            base_url: New base URL
        """
        self.base_url = base_url.rstrip('/')
    
    def close(self) -> None:
        """Close the underlying HTTP session."""
        self._session.close()

    def execute_with_retry(
        self,
        workflow_id: str,
        input_data: Optional[Dict[str, Any]] = None,
        timeout: float = 30.0,
        max_retries: int = 3,
        initial_delay: float = 1.0,
        max_delay: float = 30.0,
        backoff_multiplier: float = 2.0
    ) -> WorkflowExecutionResponse:
        """
        Execute workflow with automatic retry on rate limit.

        Args:
            workflow_id: The ID of the workflow to execute
            input_data: Input data to pass to the workflow (can include file-like objects)
            timeout: Timeout in seconds
            max_retries: Maximum number of retries (default: 3)
            initial_delay: Initial delay in seconds (default: 1.0)
            max_delay: Maximum delay in seconds (default: 30.0)
            backoff_multiplier: Backoff multiplier (default: 2.0)

        Returns:
            WorkflowExecutionResult for a standard workflow, or the custom JSON object from a
            successful Response block

        Raises:
            TradingGooseError: If max retries exceeded or other error occurs
        """
        last_error = None
        delay = initial_delay

        for attempt in range(max_retries + 1):
            try:
                return self.execute_workflow(
                    workflow_id,
                    input_data,
                    timeout
                )
            except TradingGooseError as e:
                if e.code != 'RATE_LIMIT_EXCEEDED':
                    raise

                last_error = e

                # Don't retry after last attempt
                if attempt == max_retries:
                    break

                # A server-provided Retry-After is a minimum and must not be shortened by jitter.
                retry_after = (
                    self._rate_limit_info.retry_after / 1000
                    if self._rate_limit_info and self._rate_limit_info.retry_after is not None
                    else None
                )
                wait_time = retry_after if retry_after is not None else min(delay, max_delay)
                sleep_time = (
                    wait_time
                    if retry_after is not None
                    else wait_time * (0.75 + random.random() * 0.5)
                )

                time.sleep(sleep_time)

                # Exponential backoff for next attempt
                delay *= backoff_multiplier

        raise last_error or TradingGooseError('Max retries exceeded', 'MAX_RETRIES_EXCEEDED')

    def get_rate_limit_info(self) -> Optional[RateLimitInfo]:
        """
        Get current rate limit information.

        Returns:
            RateLimitInfo object or None if no rate limit info available
        """
        return self._rate_limit_info

    def _update_rate_limit_info(self, response: requests.Response) -> None:
        """
        Update rate limit info from response headers.

        Args:
            response: The response object to extract headers from
        """
        limit = response.headers.get('x-ratelimit-limit')
        remaining = response.headers.get('x-ratelimit-remaining')
        reset = response.headers.get('x-ratelimit-reset')
        retry_after = _parse_retry_after(response.headers.get('retry-after'))

        if limit or remaining or reset or retry_after is not None:
            self._rate_limit_info = RateLimitInfo(
                limit=int(limit) if limit else 0,
                remaining=int(remaining) if remaining else 0,
                reset=reset or '',
                retry_after=retry_after
            )
        else:
            self._rate_limit_info = None

    def get_usage_limits(self) -> UsageLimits:
        """
        Get current usage limits and quota information.

        Returns:
            UsageLimits object containing usage and quota data

        Raises:
            TradingGooseError: If getting usage limits fails
        """
        url = f"{self.base_url}/api/users/me/usage-limits"

        try:
            response = self._session.get(url, allow_redirects=False)

            self._update_rate_limit_info(response)

            if not 200 <= response.status_code < 300:
                try:
                    error_data = response.json()
                    error_message = error_data.get('error', f'HTTP {response.status_code}: {response.reason}')
                    error_code = error_data.get('code')
                except (ValueError, KeyError):
                    error_message = f'HTTP {response.status_code}: {response.reason}'
                    error_code = None

                raise TradingGooseError(error_message, error_code, response.status_code)

            data = response.json()

            return UsageLimits(
                success=data.get('success', True),
                rate_limit=data.get('rateLimit', {}),
                usage=data.get('usage', {}),
                storage=data.get('storage', {})
            )

        except requests.RequestException as e:
            raise TradingGooseError(f'Failed to get usage limits: {str(e)}', 'USAGE_ERROR')

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()
