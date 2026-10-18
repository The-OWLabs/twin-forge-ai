"""Ports for visual quality inspection following Hexagonal Architecture."""
from abc import ABC, abstractmethod
from typing import Optional
from backend.core.interfaces.base import IInputPort, IOutputPort
from backend.features.visual_quality_inspection.domain.models import (
    InspectionResult,
    LineQualitySummary,
    DefectFinding,
    GeminiAdvisoryExplanation,
    GoldenTemplate,
    HumanDispositionRequest,
    HumanDispositionRecord,
)


class IVisualQualityUseCase(IInputPort, ABC):
    @abstractmethod
    async def inspect_part(
        self, camera_id: str, part_id: str, frame_bytes: Optional[bytes] = None
    ) -> InspectionResult:
        pass

    @abstractmethod
    async def get_line_quality_summary(self, line_id: str) -> LineQualitySummary:
        pass

    @abstractmethod
    async def record_human_disposition(
        self, request: HumanDispositionRequest
    ) -> HumanDispositionRecord:
        pass

    @abstractmethod
    async def register_golden_template(
        self, template: GoldenTemplate
    ) -> GoldenTemplate:
        pass

    @abstractmethod
    async def get_golden_template(
        self, part_number: str
    ) -> Optional[GoldenTemplate]:
        pass


class IInspectionHistoryStore(IOutputPort, ABC):
    @abstractmethod
    async def record_result(self, result: InspectionResult) -> None:
        pass

    @abstractmethod
    async def get_recent_results(self, line_id: str, limit: int = 100) -> list[InspectionResult]:
        pass

    @abstractmethod
    async def record_disposition(self, record: HumanDispositionRecord) -> None:
        pass

    @abstractmethod
    async def get_disposition_audit_trail(self, limit: int = 50) -> list[HumanDispositionRecord]:
        pass

    @abstractmethod
    async def save_golden_template(self, template: GoldenTemplate) -> None:
        pass

    @abstractmethod
    async def get_golden_template(self, part_number: str) -> Optional[GoldenTemplate]:
        pass


class IVertexAIVisionClient(IOutputPort, ABC):
    """Interacts with Vertex AI custom-trained image classification & object detection models."""

    @abstractmethod
    async def predict_defects(self, image_bytes: bytes, part_id: str) -> list[DefectFinding]:
        pass


class IGeminiVisualReasoningClient(IOutputPort, ABC):
    """Provides supplementary generative explanations and visual summaries on Vertex AI."""

    @abstractmethod
    async def generate_inspection_explanation(
        self, part_id: str, defects: list[DefectFinding], similarity: float
    ) -> GeminiAdvisoryExplanation:
        pass


class ICloudVisionOCRClient(IOutputPort, ABC):
    """Google Cloud Vision API managed barcode and OCR recognition."""

    @abstractmethod
    async def read_barcode_and_text(self, image_bytes: bytes) -> tuple[Optional[str], Optional[str]]:
        pass


class IOpenCVAlignmentClient(IOutputPort, ABC):
    """Deterministic OpenCV operations: Keypoint homography alignment & pixel difference."""

    @abstractmethod
    def align_and_compute_difference(
        self, live_image_bytes: bytes, golden_template_bytes: Optional[bytes] = None
    ) -> tuple[float, list[DefectFinding]]:
        pass
