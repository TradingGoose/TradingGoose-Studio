import asyncio
import hmac
from contextlib import asynccontextmanager
from time import perf_counter
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.concurrency import run_in_threadpool

from kronos_api.config import Settings
from kronos_api.runtime import KronosRuntime
from kronos_api.schemas import (
    ForecastDiagnostics,
    ForecastInputMetadata,
    ForecastPoint,
    ForecastRequest,
    ForecastResponse,
    ForecastTiming,
    ModelMetadata,
)


class QueueFullError(RuntimeError):
    pass


class InferenceGate:
    def __init__(self, concurrency: int, max_queue: int):
        self._semaphore = asyncio.Semaphore(concurrency)
        self._max_queue = max_queue
        self._waiting = 0
        self._counter_lock = asyncio.Lock()

    @asynccontextmanager
    async def enter(self):
        queued = self._semaphore.locked()
        if queued:
            async with self._counter_lock:
                if self._waiting >= self._max_queue:
                    raise QueueFullError("Kronos inference queue is full")
                self._waiting += 1
        started = perf_counter()
        try:
            await self._semaphore.acquire()
            yield (perf_counter() - started) * 1000
        finally:
            if queued:
                async with self._counter_lock:
                    self._waiting -= 1
            if self._semaphore.locked():
                self._semaphore.release()


def reconcile_points(raw_points: list[dict[str, Any]]) -> tuple[list[ForecastPoint], int]:
    points: list[ForecastPoint] = []
    reconciled = 0
    for raw in raw_points:
        point = ForecastPoint.model_validate(raw)
        high = max(point.high, point.open, point.close)
        low = min(point.low, point.open, point.close)
        if high != point.high or low != point.low:
            reconciled += 1
            point = point.model_copy(update={"high": high, "low": low})
        if min(point.open, point.high, point.low, point.close) <= 0:
            raise ValueError("Kronos returned non-positive forecast prices")
        points.append(point)
    return points, reconciled


def create_app(settings: Settings | None = None, runtime: Any | None = None) -> FastAPI:
    configured = settings or Settings()
    model_runtime = runtime or KronosRuntime(configured)
    gate = InferenceGate(configured.inference_concurrency, configured.max_queue)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if runtime is None:
            await run_in_threadpool(model_runtime.load)
        yield

    app = FastAPI(
        title="TradingGoose Kronos Inference",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )

    def authorize(authorization: str | None = Header(default=None)) -> None:
        expected = f"Bearer {configured.api_token}"
        if authorization is None or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="Unauthorized")

    @app.get("/health/live")
    async def live():
        return {"status": "alive"}

    @app.get("/health/ready")
    async def ready():
        if not model_runtime.ready:
            raise HTTPException(status_code=503, detail="Kronos model is not ready")
        return {"status": "ready", "model": model_runtime.metadata}

    @app.post("/v1/forecast", response_model=ForecastResponse)
    async def forecast(request: ForecastRequest, _authorized: None = Depends(authorize)):
        if not model_runtime.ready:
            raise HTTPException(status_code=503, detail="Kronos model is not ready")

        total_started = perf_counter()
        try:
            async with gate.enter() as queue_ms:
                inference_started = perf_counter()
                raw_points = await run_in_threadpool(model_runtime.predict, request)
                inference_ms = (perf_counter() - inference_started) * 1000
        except QueueFullError as error:
            raise HTTPException(status_code=429, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=502, detail="Kronos inference failed") from error

        try:
            points, reconciliation_count = reconcile_points(raw_points)
        except (ValueError, TypeError) as error:
            raise HTTPException(status_code=502, detail="Kronos returned invalid forecast data") from error
        if len(points) != len(request.future_timestamps):
            raise HTTPException(status_code=502, detail="Kronos returned an unexpected forecast length")

        warnings: list[str] = []
        volume_imputed = request.history[0].volume is None
        amount_imputed = request.history[0].amount is None
        if volume_imputed:
            warnings.append("volume_imputed")
        if reconciliation_count:
            warnings.append("forecast_candles_reconciled")

        return ForecastResponse(
            request_id=request.request_id,
            forecast=points,
            model=ModelMetadata.model_validate(model_runtime.metadata),
            input=ForecastInputMetadata(
                listing=request.listing,
                interval=request.interval,
                timezone=request.timezone,
                normalization_mode=request.normalization_mode,
                bar_count=len(request.history),
                last_completed_bar_timestamp=request.history[-1].timestamp,
            ),
            parameters=request.parameters,
            diagnostics=ForecastDiagnostics(
                volume_imputed=volume_imputed,
                amount_imputed=amount_imputed,
                candle_reconciliation_count=reconciliation_count,
                warnings=warnings,
            ),
            timing_ms=ForecastTiming(
                queue=queue_ms,
                inference=inference_ms,
                total=(perf_counter() - total_started) * 1000,
            ),
        )

    return app
