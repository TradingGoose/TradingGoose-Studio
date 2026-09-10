from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KRONOS_", extra="ignore")

    api_token: str = Field(min_length=32)
    model_path: str = "/models/kronos-base"
    tokenizer_path: str = "/models/kronos-tokenizer-base"
    model_name: str = "NeoQuasar/Kronos-base"
    model_revision: str = "2b554741eca47781b64468546e77fef3e85130e6"
    tokenizer_revision: str = "0e0117387f39004a9016484a186a908917e22426"
    source_revision: str = "67b630e67f6a18c9e9be918d9b4337c960db1e9a"
    device: str = "cpu"
    max_context: int = Field(default=512, ge=32, le=2048)
    max_queue: int = Field(default=8, ge=0, le=64)
    inference_concurrency: int = Field(default=1, ge=1, le=4)
    warmup: bool = True
