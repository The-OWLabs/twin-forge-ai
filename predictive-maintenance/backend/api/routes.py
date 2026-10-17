"""FastAPI route controllers implementing the REST API specification."""
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Depends
from backend.services.machine_service import MachineService
from backend.repositories.local_mock_repo import LocalMockMachineRepository

router = APIRouter()

# Default singleton repository for local execution
_default_repo = LocalMockMachineRepository()
_default_service = MachineService(_default_repo)


def get_service() -> MachineService:
    return _default_service


@router.get("/health")
async def health_check():
    """Liveness probe and platform status."""
    return {"status": "HEALTHY", "service": "GCP Predictive Maintenance Platform"}


@router.get("/machines")
async def get_machines(
    plant_id: Optional[str] = Query(None, description="Filter by plant location"),
    risk_category: Optional[str] = Query(None, description="Filter by risk category: LOW | MEDIUM | HIGH"),
    service: MachineService = Depends(get_service),
):
    """Retrieve all monitored machines with latest telemetry and risk classification."""
    return await service.list_machines(plant_id=plant_id, risk_category=risk_category)


@router.get("/machines/{machine_id}")
async def get_machine(machine_id: str, service: MachineService = Depends(get_service)):
    """Retrieve detailed state and configuration for a specific machine."""
    machine = await service.get_machine_details(machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    return machine


@router.get("/machines/{machine_id}/readings")
async def get_machine_readings(
    machine_id: str,
    limit: int = Query(50, ge=1, le=500, description="Number of historical readings to return"),
    service: MachineService = Depends(get_service),
):
    """Retrieve paginated time-series telemetry readings for a machine."""
    return await service.get_readings_history(machine_id, limit=limit)


@router.get("/machines/{machine_id}/predictions")
async def get_machine_predictions(machine_id: str, service: MachineService = Depends(get_service)):
    """Retrieve the latest predictive failure probability, risk tier, and recommended action."""
    pred = await service.get_predictions(machine_id)
    if not pred:
        raise HTTPException(status_code=404, detail=f"No predictions found for {machine_id}")
    return pred


@router.get("/predictions/high-risk")
async def get_high_risk_predictions(service: MachineService = Depends(get_service)):
    """Retrieve active high-risk equipment alerts requiring immediate operational attention."""
    return await service.get_high_risk_alerts()


@router.get("/analytics/summary")
async def get_analytics_summary(service: MachineService = Depends(get_service)):
    """Retrieve fleet-wide health KPIs, risk distribution, and reliability metrics."""
    return await service.get_fleet_analytics()
