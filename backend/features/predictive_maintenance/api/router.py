"""FastAPI router for predictive maintenance endpoints including dynamic runtime configuration,
machine health monitoring, telemetry feeds, and predictive failure analytics.
"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Depends
from backend.features.predictive_maintenance.services.maintenance_service import PredictiveMaintenanceService
from backend.features.predictive_maintenance.adapters.mock_telemetry import InMemoryTelemetryReader
from backend.features.predictive_maintenance.domain.models import AssetDiagnosticReport, RulEstimate
from backend.features.predictive_maintenance.config.models import (
    PredictiveMaintenanceConfig,
    maintenance_config_store,
)
from backend.features.predictive_maintenance.services.machine_service import MachineService
from backend.features.predictive_maintenance.repositories.local_mock_repo import LocalMockMachineRepository

# Singletons for mock/local execution
_telemetry_reader = InMemoryTelemetryReader()
_service = PredictiveMaintenanceService(_telemetry_reader, maintenance_config_store)
_default_repo = LocalMockMachineRepository(num_machines=20)
_machine_service = MachineService(_default_repo)


def get_machine_service() -> MachineService:
    return _machine_service


# Primary feature router mounted under /api/v1/maintenance
router = APIRouter(prefix="/maintenance", tags=["Predictive Maintenance"])

# Root router for top-level REST endpoints (/machines, /analytics/summary, etc.)
root_router = APIRouter(tags=["Predictive Maintenance"])


# Handlers
async def handle_list_machines(
    plant_id: Optional[str] = Query(None, description="Filter by plant location"),
    risk_category: Optional[str] = Query(None, description="Filter by risk category: LOW | MEDIUM | HIGH"),
    service: MachineService = Depends(get_machine_service),
):
    """Retrieve all monitored machines with latest telemetry and risk classification."""
    return await service.list_machines(plant_id=plant_id, risk_category=risk_category)


async def handle_get_machine(machine_id: str, service: MachineService = Depends(get_machine_service)):
    """Retrieve detailed state and configuration for a specific machine."""
    machine = await service.get_machine_details(machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    return machine


async def handle_get_readings(
    machine_id: str,
    limit: int = Query(50, ge=1, le=500, description="Number of historical readings to return"),
    service: MachineService = Depends(get_machine_service),
):
    """Retrieve paginated time-series telemetry readings for a machine."""
    return await service.get_readings_history(machine_id, limit=limit)


async def handle_get_predictions(machine_id: str, service: MachineService = Depends(get_machine_service)):
    """Retrieve the latest predictive failure probability, risk tier, and recommended action."""
    pred = await service.get_predictions(machine_id)
    if not pred:
        raise HTTPException(status_code=404, detail=f"No predictions found for {machine_id}")
    return pred


async def handle_get_high_risk(service: MachineService = Depends(get_machine_service)):
    """Retrieve active high-risk equipment alerts requiring immediate operational attention."""
    return await service.get_high_risk_alerts()


async def handle_get_analytics(service: MachineService = Depends(get_machine_service)):
    """Retrieve fleet-wide health KPIs, risk distribution, and reliability metrics."""
    return await service.get_fleet_analytics()


# Register on router (/api/v1/maintenance/...)
router.add_api_route("/machines", handle_list_machines, methods=["GET"])
router.add_api_route("/machines/{machine_id}", handle_get_machine, methods=["GET"])
router.add_api_route("/machines/{machine_id}/readings", handle_get_readings, methods=["GET"])
router.add_api_route("/machines/{machine_id}/predictions", handle_get_predictions, methods=["GET"])
router.add_api_route("/predictions/high-risk", handle_get_high_risk, methods=["GET"])
router.add_api_route("/analytics/summary", handle_get_analytics, methods=["GET"])

# Register on root_router (top-level /machines, /analytics/summary per GCP spec)
root_router.add_api_route("/machines", handle_list_machines, methods=["GET"])
root_router.add_api_route("/machines/{machine_id}", handle_get_machine, methods=["GET"])
root_router.add_api_route("/machines/{machine_id}/readings", handle_get_readings, methods=["GET"])
root_router.add_api_route("/machines/{machine_id}/predictions", handle_get_predictions, methods=["GET"])
root_router.add_api_route("/predictions/high-risk", handle_get_high_risk, methods=["GET"])
root_router.add_api_route("/analytics/summary", handle_get_analytics, methods=["GET"])


# Diagnostics & Dynamic Config endpoints
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
