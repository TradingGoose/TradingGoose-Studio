from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from kronos_api.config import Settings
from kronos_api.main import create_app


TOKEN = "test-token-that-is-at-least-thirty-two-characters"


class FakeRuntime:
    ready = True
    metadata = {
        "name": "NeoQuasar/Kronos-base",
        "sourceRevision": "source-revision",
        "modelRevision": "model-revision",
        "tokenizerRevision": "tokenizer-revision",
        "device": "cpu",
        "maxContext": 512,
    }

    def predict(self, request):
        close = request.history[-1].close
        return [
            {
                "timestamp": timestamp,
                "open": close,
                "high": close + 1,
                "low": close - 1,
                "close": close + 0.5,
                "volume": 100.0,
                "amount": 10_000.0,
            }
            for timestamp in request.future_timestamps
        ]


def settings() -> Settings:
    return Settings(
        api_token=TOKEN,
        model_path="/models/kronos-base",
        tokenizer_path="/models/kronos-tokenizer-base",
    )


def bars(count: int = 32):
    start = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)
    return [
        {
            "timestamp": (start + timedelta(minutes=5 * i)).isoformat(),
            "open": 100 + i,
            "high": 102 + i,
            "low": 99 + i,
            "close": 101 + i,
            "volume": 1000 + i,
        }
        for i in range(count)
    ]


def valid_request():
    history = bars()
    last = datetime.fromisoformat(history[-1]["timestamp"])
    return {
        "requestId": "workflow-1:block-1:execution-1",
        "listing": {"listing_id": "listing-1", "listing_type": "stock"},
        "interval": "5m",
        "timezone": "America/New_York",
        "normalizationMode": "raw",
        "history": history,
        "futureTimestamps": [
            (last + timedelta(minutes=5 * i)).isoformat() for i in range(1, 4)
        ],
        "parameters": {"temperature": 1.0, "topP": 0.9, "sampleCount": 1},
    }


def client(runtime=None):
    return TestClient(create_app(settings=settings(), runtime=runtime or FakeRuntime()))


def test_liveness_and_readiness_expose_pinned_model_metadata():
    with client() as test_client:
        live = test_client.get("/health/live")
        ready = test_client.get("/health/ready")

    assert live.status_code == 200
    assert live.json() == {"status": "alive"}
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"
    assert ready.json()["model"]["name"] == "NeoQuasar/Kronos-base"


def test_forecast_requires_the_internal_bearer_token():
    with client() as test_client:
        response = test_client.post("/v1/forecast", json=valid_request())

    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_forecast_rejects_invalid_historical_candles():
    request = valid_request()
    request["history"][-1]["high"] = request["history"][-1]["close"] - 1

    with client() as test_client:
        response = test_client.post(
            "/v1/forecast",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json=request,
        )

    assert response.status_code == 422


def test_forecast_returns_validated_points_and_provenance():
    with client() as test_client:
        response = test_client.post(
            "/v1/forecast",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json=valid_request(),
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["requestId"] == "workflow-1:block-1:execution-1"
    assert len(payload["forecast"]) == 3
    assert payload["model"]["modelRevision"] == "model-revision"
    assert payload["input"]["barCount"] == 32
    assert payload["input"]["timezone"] == "America/New_York"
    assert payload["diagnostics"] == {
        "amountImputed": True,
        "candleReconciliationCount": 0,
        "volumeImputed": False,
        "warnings": [],
    }
    assert payload["timingMs"]["total"] >= 0


def test_not_ready_service_fails_closed():
    runtime = FakeRuntime()
    runtime.ready = False

    with client(runtime) as test_client:
        ready = test_client.get("/health/ready")
        forecast = test_client.post(
            "/v1/forecast",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json=valid_request(),
        )

    assert ready.status_code == 503
    assert forecast.status_code == 503
