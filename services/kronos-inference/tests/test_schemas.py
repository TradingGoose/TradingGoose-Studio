from datetime import datetime, timedelta, timezone

import pytest

from kronos_api.schemas import ForecastRequest


def request_data():
    start = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)
    history = []
    for i in range(32):
        history.append(
            {
                "timestamp": (start + timedelta(minutes=5 * i)).isoformat(),
                "open": 100 + i,
                "high": 102 + i,
                "low": 99 + i,
                "close": 101 + i,
                "volume": 1000 + i,
            }
        )
    return {
        "requestId": "request-1",
        "listing": {"listing_id": "listing-1", "listing_type": "stock"},
        "interval": "5m",
        "timezone": "America/New_York",
        "normalizationMode": "raw",
        "history": history,
        "futureTimestamps": [
            (start + timedelta(minutes=5 * (32 + i))).isoformat() for i in range(3)
        ],
    }


def test_request_rejects_duplicate_timestamps():
    data = request_data()
    data["history"][-1]["timestamp"] = data["history"][-2]["timestamp"]

    with pytest.raises(ValueError, match="strictly increasing"):
        ForecastRequest.model_validate(data)


def test_request_rejects_future_timestamp_before_last_bar():
    data = request_data()
    data["futureTimestamps"][0] = data["history"][-1]["timestamp"]

    with pytest.raises(ValueError, match="after the final historical timestamp"):
        ForecastRequest.model_validate(data)


def test_request_rejects_unknown_fields():
    data = request_data()
    data["modelUrl"] = "http://attacker.invalid/model"

    with pytest.raises(ValueError):
        ForecastRequest.model_validate(data)
