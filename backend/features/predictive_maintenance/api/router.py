"""FastAPI router for predictive maintenance endpoints including dynamic runtime configuration."""
from fastapi import APIRouter
from backend.features.predictive_maintenance.services.maintenance_service import PredictiveMaintenanceService
from backend.features.predictive_maintenance.adapters.mock_telemetry import InMemoryTelemetryReader
from backend.features.predictive_maintenance.domain.models import AssetDiagnosticReport, RulEstimate
from backend.features.predictive_maintenance.config.models import (
    PredictiveMaintenanceConfig,
    maintenance_config_store,
)

router = APIRouter(prefix="/maintenance", tags=["Predictive Maintenance"])

_telemetry_reader = InMemoryTelemetryReader()
_service = PredictiveMaintenanceService(_telemetry_reader, maintenance_config_store)


@router.get("/diagnostics/{asset_id}", response_model=AssetDiagnosticReport)
async def get_asset_diagnostics(asset_id: str) -> AssetDiagnosticReport:
    """Diagnose an asset's bearing condition, ISO 10816 zone, and failure risk."""
    return await _service.diagnose_asset(asset_id)


@router.get("/rul/{asset_id}", response_model=RulEstimate)
async def get_asset_rul(asset_id: str) -> RulEstimate:
    """Estimate the Remaining Useful Life (RUL) of an asset before trip threshold breach."""
    return await _service.estimate_rul(asset_id)


@router.get("/config", response_model=PredictiveMaintenanceConfig)
async def get_maintenance_config() -> PredictiveMaintenanceConfig:
    """Get active predictive maintenance configuration and ISO 10816 thresholds."""
    return maintenance_config_store.get_config()


@router.put("/config", response_model=PredictiveMaintenanceConfig)
async def update_maintenance_config(config: PredictiveMaintenanceConfig) -> PredictiveMaintenanceConfig:
    """Update predictive maintenance thresholds dynamically at runtime from UI."""
    return maintenance_config_store.update_config(config)
