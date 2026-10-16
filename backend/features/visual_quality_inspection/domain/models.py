"""Domain models and defect classifications for visual optical inspection."""
from enum import Enum
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field
from backend.core.interfaces.base import BaseValueObject


class InspectionVerdict(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"


class DefectClass(str, Enum):
    SOLDER_BRIDGE = "SOLDER_BRIDGE"
    TOMBSTONING = "TOMBSTONING"
    COMPONENT_MISALIGNMENT = "COMPONENT_MISALIGNMENT"
    MISSING_PART = "MISSING_PART"
    SURFACE_SCRATCH = "SURFACE_SCRATCH"
    FOREIGN_OBJECT_DEBRIS = "FOREIGN_OBJECT_DEBRIS"


class DefectFinding(BaseValueObject):
    defect_class: DefectClass
    confidence: float = Field(..., ge=0.0, le=1.0)
    bounding_box: tuple[int, int, int, int] = Field(..., description="(x, y, width, height)")
    severity: str = "HIGH"


class InspectionResult(BaseModel):
    inspection_id: str
    camera_id: str
    part_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    verdict: InspectionVerdict
    defects: list[DefectFinding] = Field(default_factory=list)
    similarity_score_to_golden: float = Field(..., ge=0.0, le=1.0)


class LineQualitySummary(BaseModel):
    line_id: str
    first_pass_yield_pct: float
    dpmo: float
    total_inspected: int
    total_defective: int
    top_defect_classes: list[tuple[DefectClass, int]]
