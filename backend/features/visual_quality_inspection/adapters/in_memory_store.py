"""In-memory store adapter for visual quality records."""
from backend.features.visual_quality_inspection.ports.contracts import IInspectionHistoryStore
from backend.features.visual_quality_inspection.domain.models import InspectionResult


class InMemoryInspectionStore(IInspectionHistoryStore):
    def __init__(self) -> None:
        self._history: list[InspectionResult] = []

    async def record_result(self, result: InspectionResult) -> None:
        self._history.append(result)

    async def get_recent_results(self, line_id: str, limit: int = 100) -> list[InspectionResult]:
        return self._history[-limit:]
