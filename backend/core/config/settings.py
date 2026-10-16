"""Global application settings and environment variable schema."""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class BackendSettings(BaseSettings):
    """TwinForge Backend configuration schema with sensible industrial defaults."""
    app_name: str = "TwinForge Enterprise Intelligence Backend"
    environment: str = Field(default="development", description="development | staging | production")
    debug: bool = False
    port: int = 8000
    host: str = "0.0.0.0"

    # AI & Model provider
    ai_provider: str = Field(default="gemini", description="gemini | claude | openai | compatible")
    gemini_api_key: str = ""
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    ai_enabled: bool = True

    # Industrial Connectors
    opcua_endpoint_url: str = "opc.tcp://localhost:4840"
    mqtt_broker_url: str = "mqtt://localhost:1883"
    modbus_host: str = "localhost"
    modbus_port: int = 502

    # MCP Server
    mcp_server_name: str = "twinforge-enterprise-mcp"
    mcp_auth_token: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = BackendSettings()
