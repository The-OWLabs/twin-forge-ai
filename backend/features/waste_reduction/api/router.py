"""FastAPI router for waste reduction endpoints."""
from fastapi import APIRouter
from backend.features.waste_reduction.services.waste_service import WasteReductionService
from backend.features.waste_reduction.adapters.mock_scrap_reader import InMemoryScrapMetricsReader
from backend.features.waste_reduction.domain.models import (
    ScrapAttributionReport,
    MachineEnergyWasteReport,
    CarbonFootprintReport,
)

router = APIRouter(prefix="/waste", tags=["Waste Reduction & Sustainability"])

_reader = InMemoryScrapMetricsReader()
_service = WasteReductionService(_reader)


@router.get("/scrap-attribution/{line_id}", response_model=ScrapAttributionReport)
async def get_scrap_attribution(line_id: str) -> ScrapAttributionReport:
    """Attribute scrap causes to specific upstream machine degradation."""
    return await _service.attribute_scrap(line_id)


@router.get("/energy-waste/{asset_id}", response_model=MachineEnergyWasteReport)
async def get_energy_waste(asset_id: str) -> MachineEnergyWasteReport:
    """Detect machine idle power waste and excess friction drag."""
    return await _service.evaluate_machine_energy_waste(asset_id)


@router.get("/carbon/{product_id}", response_model=CarbonFootprintReport)
async def get_carbon_footprint(product_id: str) -> CarbonFootprintReport:
    """Calculate unit-level embodied Scope 1 and Scope 2 GHG emissions."""
    return await _service.compute_unit_carbon_footprint(product_id)
