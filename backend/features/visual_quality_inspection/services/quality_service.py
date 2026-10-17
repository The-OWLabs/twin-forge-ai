"""Visual quality application service using configurable inspection parameters."""
import uuid
from typing import Optional
from backend.features.visual_quality_inspection.ports.contracts import (
    IVisualQualityUseCase,
    IInspectionHistoryStore,
)
from backend.features.visual_quality_inspection.domain.models import (
    InspectionResult,
    InspectionVerdict,
    DefectFinding,
    DefectClass,
    LineQualitySummary,
)
from backend.features.visual_quality_inspection.config.models import (
    QualityConfigStore,
    quality_config_store,
)


class VisualQualityService(IVisualQualityUseCase):
    def __init__(
        self,
        history_store: IInspectionHistoryStore,
        config_store: Optional[QualityConfigStore] = None,
    ) -> None:
        self.store = history_store
        self.config_store = config_store or quality_config_store

    async def inspect_part(self, camera_id: str, part_id: str, frame_bytes: Optional[bytes] = None) -> InspectionResult:
        cfg = self.config_store.get_config()
        is_defective = part_id.endswith("DEF") or (part_id[-1].isdigit() and int(part_id[-1]) % 5 == 0)
        
        defects: list[DefectFinding] = []
        similarity = 0.98

        if is_defective:
            similarity = 0.72
            if similarity < cfg.golden_similarity_threshold:
                defects.append(
                    DefectFinding(
                        defect_class=DefectClass.SOLDER_BRIDGE,
                        confidence=0.94,
                        bounding_box=(120, 84, 32, 18),
                        severity="HIGH",
                    )
                )
            verdict = InspectionVerdict.FAIL
        else:
            verdict = InspectionVerdict.PASS

        result = InspectionResult(
            inspection_id=str(uuid.uuid4())[:8],
            camera_id=camera_id,
            part_id=part_id,
            verdict=verdict,
            defects=defects,
            similarity_score_to_golden=similarity,
        )

        await self.store.record_result(result)
        return result

    async def get_line_quality_summary(self, line_id: str) -> LineQualitySummary:
        cfg = self.config_store.get_config()
        results = await self.store.get_recent_results(line_id, limit=200)
        total = len(results)
        if total == 0:
            return LineQualitySummary(
                line_id=line_id,
                first_pass_yield_pct=cfg.target_first_pass_yield_pct,
                dpmo=cfg.max_acceptable_dpmo,
                total_inspected=0,
                total_defective=0,
                top_defect_classes=[],
            )

        defective = sum(1 for r in results if r.verdict == InspectionVerdict.FAIL)
        fpy = round(((total - defective) / total) * 100.0, 2)
        dpmo = round((defective / total) * 1_000_000.0, 1)

        defect_counts: dict[DefectClass, int] = {}
        for r in results:
            for d in r.defects:
                defect_counts[d.defect_class] = defect_counts.get(d.defect_class, 0) + 1

        top_classes = sorted(defect_counts.items(), key=lambda x: x[1], reverse=True)[:3]

        return LineQualitySummary(
            line_id=line_id,
            first_pass_yield_pct=fpy,
            dpmo=dpmo,
            total_inspected=total,
            total_defective=defective,
            top_defect_classes=top_classes,
        )
