import math
from typing import Any

import pandas as pd

from kronos_api.config import Settings
from kronos_api.schemas import ForecastRequest


class KronosRuntime:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.ready = False
        self._predictor = None
        self.metadata = {
            "name": settings.model_name,
            "sourceRevision": settings.source_revision,
            "modelRevision": settings.model_revision,
            "tokenizerRevision": settings.tokenizer_revision,
            "device": settings.device,
            "maxContext": settings.max_context,
        }

    def load(self) -> None:
        from model import Kronos, KronosPredictor, KronosTokenizer

        tokenizer = KronosTokenizer.from_pretrained(self.settings.tokenizer_path)
        model = Kronos.from_pretrained(self.settings.model_path)
        tokenizer.eval()
        model.eval()
        self._predictor = KronosPredictor(
            model,
            tokenizer,
            device=self.settings.device,
            max_context=self.settings.max_context,
        )
        if self.settings.warmup:
            self._warmup()
        self.ready = True

    def _warmup(self) -> None:
        start = pd.Timestamp("2026-01-02T09:30:00", tz="America/New_York")
        timestamps = pd.Series(pd.date_range(start=start, periods=32, freq="5min"))
        future = pd.Series([timestamps.iloc[-1] + pd.Timedelta(minutes=5)])
        values = [100.0 + index * 0.1 for index in range(32)]
        frame = pd.DataFrame(
            {
                "open": values,
                "high": [value + 0.2 for value in values],
                "low": [value - 0.2 for value in values],
                "close": [value + 0.1 for value in values],
                "volume": [1000.0] * 32,
            }
        )
        self._predictor.predict(
            df=frame,
            x_timestamp=timestamps,
            y_timestamp=future,
            pred_len=1,
            T=1.0,
            top_p=0.9,
            sample_count=1,
            verbose=False,
        )

    def predict(self, request: ForecastRequest) -> list[dict[str, Any]]:
        if not self.ready or self._predictor is None:
            raise RuntimeError("Kronos model is not ready")

        records: dict[str, list[float]] = {
            "open": [bar.open for bar in request.history],
            "high": [bar.high for bar in request.history],
            "low": [bar.low for bar in request.history],
            "close": [bar.close for bar in request.history],
        }
        if request.history[0].volume is not None:
            records["volume"] = [float(bar.volume) for bar in request.history]
        if request.history[0].amount is not None:
            records["amount"] = [float(bar.amount) for bar in request.history]

        frame = pd.DataFrame(records)
        historical = pd.Series(pd.to_datetime([bar.timestamp for bar in request.history], utc=True))
        future = pd.Series(pd.to_datetime(request.future_timestamps, utc=True))
        historical_local = historical.dt.tz_convert(request.timezone)
        future_local = future.dt.tz_convert(request.timezone)

        predicted = self._predictor.predict(
            df=frame,
            x_timestamp=historical_local,
            y_timestamp=future_local,
            pred_len=len(future_local),
            T=request.parameters.temperature,
            top_p=request.parameters.top_p,
            sample_count=request.parameters.sample_count,
            verbose=False,
        )

        points: list[dict[str, Any]] = []
        for timestamp, row in zip(future, predicted.itertuples(index=False)):
            values = [row.open, row.high, row.low, row.close, row.volume, row.amount]
            if not all(math.isfinite(float(value)) for value in values):
                raise RuntimeError("Kronos returned non-finite forecast values")
            points.append(
                {
                    "timestamp": timestamp.to_pydatetime(),
                    "open": float(row.open),
                    "high": float(row.high),
                    "low": float(row.low),
                    "close": float(row.close),
                    "volume": max(0.0, float(row.volume)),
                    "amount": max(0.0, float(row.amount)),
                }
            )
        return points
