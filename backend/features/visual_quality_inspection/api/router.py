"""FastAPI router for visual quality inspection."""
from fastapi import APIRouter
from backend.features.visual_quality_inspection.services.quality_service import VisualQualityService
from backend.features.visual_quality_inspection.adapters.in_memory_store import InMemoryInspectionStore
from backend.features.visual_quality_inspection.domain.models import InspectionResult, LineQualitySummary

router = APIRouter(prefix="/quality", tags=["Visual Quality Inspection"])

_store = InMemoryInspectionStore()
_service = VisualQualityService(_store)


@router.post("/inspect", response_model=InspectionResult)
async def inspect_part(camera_id: str, part_id: str) -> InspectionResult:
    """Inspect part image against golden template and return verdict."""
    return await _service.inspect_part(camera_id, part_id)


@router.get("/summary/{line_id}", response_model=LineQualitySummary)
async def get_line_quality_summary(line_id: str) -> LineQualitySummary:
    """Get First-Pass Yield (FPY), DPMO, and defect distribution for a line."""
    return await _service.get_line_quality_summary(line_id)
