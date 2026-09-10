import math
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class ListingIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    listing_id: str = Field(min_length=1, max_length=255)
    listing_type: str = Field(min_length=1, max_length=64)


class MarketBar(ApiModel):
    timestamp: datetime
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: float | None = Field(default=None, ge=0)
    amount: float | None = Field(default=None, ge=0)

    @field_validator("timestamp")
    @classmethod
    def timestamp_must_have_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("timestamp must include a timezone offset")
        return value

    @field_validator("open", "high", "low", "close", "volume", "amount")
    @classmethod
    def number_must_be_finite(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("market values must be finite")
        return value

    @model_validator(mode="after")
    def validate_candle(self):
        if self.high < max(self.open, self.close):
            raise ValueError("high must be greater than or equal to open and close")
        if self.low > min(self.open, self.close):
            raise ValueError("low must be less than or equal to open and close")
        if self.low > self.high:
            raise ValueError("low must not exceed high")
        return self


class ForecastParameters(ApiModel):
    temperature: float = Field(default=1.0, gt=0, le=5)
    top_p: float = Field(default=0.9, gt=0, le=1)
    sample_count: int = Field(default=1, ge=1, le=1)


class ForecastRequest(ApiModel):
    request_id: str = Field(min_length=1, max_length=255)
    listing: ListingIdentity
    interval: str = Field(min_length=1, max_length=16)
    timezone: str = Field(min_length=1, max_length=64)
    normalization_mode: str = Field(default="raw", min_length=1, max_length=32)
    history: list[MarketBar] = Field(min_length=32, max_length=512)
    future_timestamps: list[datetime] = Field(min_length=1, max_length=32)
    parameters: ForecastParameters = Field(default_factory=ForecastParameters)

    @field_validator("timezone")
    @classmethod
    def timezone_must_exist(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as error:
            raise ValueError("timezone must be a valid IANA timezone") from error
        return value

    @field_validator("future_timestamps")
    @classmethod
    def future_timestamps_need_offsets(cls, values: list[datetime]) -> list[datetime]:
        if any(value.tzinfo is None or value.utcoffset() is None for value in values):
            raise ValueError("future timestamps must include timezone offsets")
        return values

    @model_validator(mode="after")
    def timestamps_must_be_ordered(self):
        history = [bar.timestamp for bar in self.history]
        if any(current <= previous for previous, current in zip(history, history[1:])):
            raise ValueError("historical timestamps must be strictly increasing")
        if any(
            current <= previous
            for previous, current in zip(self.future_timestamps, self.future_timestamps[1:])
        ):
            raise ValueError("future timestamps must be strictly increasing")
        if self.future_timestamps[0] <= history[-1]:
            raise ValueError("future timestamps must be after the final historical timestamp")

        has_volume = [bar.volume is not None for bar in self.history]
        has_amount = [bar.amount is not None for bar in self.history]
        if any(has_volume) and not all(has_volume):
            raise ValueError("volume must be present for every bar or omitted for every bar")
        if any(has_amount) and not all(has_amount):
            raise ValueError("amount must be present for every bar or omitted for every bar")
        return self


class ForecastPoint(ApiModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    amount: float


class ModelMetadata(ApiModel):
    name: str
    source_revision: str
    model_revision: str
    tokenizer_revision: str
    device: str
    max_context: int


class ForecastInputMetadata(ApiModel):
    listing: ListingIdentity
    interval: str
    timezone: str
    normalization_mode: str
    bar_count: int
    last_completed_bar_timestamp: datetime


class ForecastDiagnostics(ApiModel):
    volume_imputed: bool
    amount_imputed: bool
    candle_reconciliation_count: int
    warnings: list[str]


class ForecastTiming(ApiModel):
    queue: float
    inference: float
    total: float


class ForecastResponse(ApiModel):
    request_id: str
    forecast: list[ForecastPoint]
    model: ModelMetadata
    input: ForecastInputMetadata
    parameters: ForecastParameters
    diagnostics: ForecastDiagnostics
    timing_ms: ForecastTiming
