"""Ports for visual quality inspection."""
from abc import ABC, abstractmethod
from backend.core.interfaces.base import IInputPort, IOutputPort
from backend.features.visual_quality_inspection.domain.models import InspectionResult, LineQualitySummary


class IVisualQualityUseCase(IInputPort, ABC):
    @abstractmethod
    async def inspect_part(self, camera_id: str, part_id: str, frame_bytes: Optional[bytes] = None) -> InspectionResult:
        pass

    @abstractmethod
    async def get_line_quality_summary(self, line_id: str) -> LineQualitySummary:
        pass


class IInspectionHistoryStore(IOutputPort, ABC):
    @abstractmethod
    async def record_result(self, result: InspectionResult) -> None:
        pass

    @abstractmethod
    async def get_recent_results(self, line_id: str, limit: int = 100) -> list[InspectionResult]:
        pass
