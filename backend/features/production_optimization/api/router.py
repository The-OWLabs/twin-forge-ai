"""FastAPI router for production optimization endpoints."""
from fastapi import APIRouter
from backend.features.production_optimization.services.optimization_service import ProductionOptimizationService
from backend.features.production_optimization.adapters.mock_line_reader import InMemoryLineStateReader
from backend.features.production_optimization.domain.models import OEEMetrics, LineThroughputAnalysis

router = APIRouter(prefix="/production", tags=["Production Optimization"])

_reader = InMemoryLineStateReader()
_service = ProductionOptimizationService(_reader)


@router.get("/oee/{line_id}", response_model=OEEMetrics)
async def get_line_oee(line_id: str) -> OEEMetrics:
    """Compute real-time Overall Equipment Effectiveness (OEE)."""
    return await _service.compute_oee(line_id)


@router.get("/throughput/{line_id}", response_model=LineThroughputAnalysis)
async def get_line_throughput(line_id: str) -> LineThroughputAnalysis:
    """Analyze line bottleneck, work-in-progress, and throughput pacing."""
    return await _service.analyze_line_throughput(line_id)
