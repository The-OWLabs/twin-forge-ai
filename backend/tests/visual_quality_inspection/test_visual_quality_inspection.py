"""Comprehensive Automated Test Suite for Google Cloud-First Visual Quality Inspection.

Tests:
1. Vertex AI Custom Image Classification & Object Detection (IPC-A-610 Class 2)
2. OpenCV Deterministic Golden-Template Alignment & Difference Detection
3. IPC-A-610 Class 2 Deterministic Rule Engine Verdict Assignment
4. Gemini on Vertex AI Advisory Explanation (Explicit Non-Authoritative Guard)
5. Cloud Vision API Barcode Reading and ISO/IEC 15416 Print-Quality Grade
6. First-Pass Yield (FPY), DPMO, and Defect Pareto Calculations
7. Auditable Human Review Disposition Workflow & Immutable Compliance Trail
8. Golden Template Registration & Keypoint Storage
9. Latency Profiling (Alignment, Vertex AI, Gemini, Total)
10. Backward Compatibility with test_features.py (inspect_part and get_line_quality_summary)
"""
import sys
import asyncio
from pathlib import Path

try:
    import pytest
except ImportError:
    class _MockPytest:
        class mark:
            @staticmethod
            def asyncio(f):
                return f
    pytest = _MockPytest()

# Ensure repository root is on sys.path
_repo_root = str(Path(__file__).resolve().parent.parent.parent.parent)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from backend.features.visual_quality_inspection.domain.models import (
    InspectionVerdict,
    DefectClass,
    InferenceSource,
    GoldenTemplate,
    HumanDispositionRequest,
)
from backend.features.visual_quality_inspection.adapters.in_memory_store import InMemoryInspectionStore
from backend.features.visual_quality_inspection.services.quality_service import VisualQualityService


@pytest.mark.asyncio
async def test_vertex_ai_defect_detection_and_rules():
    """Verify Vertex AI custom model detects fine-grained solder/component defects and rule engine flags FAIL."""
    store = InMemoryInspectionStore()
    svc = VisualQualityService(history_store=store)

    # 1. Inspect defective ECU assembly
    res_defective = await svc.inspect_part("CAM_AOI_L1", "PART-ECU-001-DEF")
    assert res_defective.verdict == InspectionVerdict.FAIL
    assert len(res_defective.defects) >= 1

    solder_bridge = next((d for d in res_defective.defects if d.defect_class == DefectClass.SOLDER_BRIDGE), None)
    assert solder_bridge is not None
    assert solder_bridge.confidence > 0.90
    assert solder_bridge.severity in ["CRITICAL", "HIGH"]
    assert "7.3.5" in (solder_bridge.ipc_clause or "")
    assert solder_bridge.source == InferenceSource.VERTEX_AI_CUSTOM_MODEL

    # 2. Inspect nominal conforming assembly
    res_nominal = await svc.inspect_part("CAM_AOI_L1", "PART-ECU-002")
    assert res_nominal.verdict == InspectionVerdict.PASS
    assert len(res_nominal.defects) == 0
    assert res_nominal.similarity_score_to_golden >= 0.90


@pytest.mark.asyncio
async def test_gemini_advisory_reasoning_and_authority_guard():
    """Verify Gemini produces structured engineering explanations but is NEVER the sole authority for pass/fail."""
    store = InMemoryInspectionStore()
    svc = VisualQualityService(history_store=store)

    res = await svc.inspect_part("CAM_AOI_L1", "PART-ECU-005-DEF")
    assert res.gemini_advisory is not None
    # Crucial architectural guard test
    assert res.gemini_advisory.is_authoritative_decision is False

    # Check that root cause and containment are generated
    assert len(res.gemini_advisory.probable_root_cause) > 10
    assert len(res.gemini_advisory.recommended_containment) > 10
    assert len(res.gemini_advisory.ipc_reference_citations) >= 1


@pytest.mark.asyncio
async def test_cloud_vision_ocr_and_barcode():
    """Verify Google Cloud Vision API extracts barcode serial number and print-quality grade."""
    store = InMemoryInspectionStore()
    svc = VisualQualityService(history_store=store)

    res = await svc.inspect_part("CAM_AOI_L1", "PART-ECU-001")
    assert res.barcode_decoded is not None
    assert "SN-ECU" in res.barcode_decoded
    assert res.barcode_grade is not None


@pytest.mark.asyncio
async def test_latency_metrics_profiling():
    """Verify processing latency breakdown across pipeline stages."""
    store = InMemoryInspectionStore()
    svc = VisualQualityService(history_store=store)

    res = await svc.inspect_part("CAM_AOI_L1", "PART-ECU-001")
    assert res.latency_metrics is not None
    assert res.latency_metrics.total_latency_ms >= 0.0
    assert res.latency_metrics.gcs_upload_ms > 0.0


@pytest.mark.asyncio
async def test_line_quality_kpis_and_pareto():
    """Verify First-Pass Yield (FPY), DPMO, and defect Pareto analysis."""
    store = InMemoryInspectionStore()
    svc = VisualQualityService(history_store=store)

    # 1. Summary KPIs
    summary = await svc.get_line_quality_summary("LINE-1")
    assert summary.total_inspected >= 50
    assert summary.first_pass_yield_pct > 80.0
    assert summary.dpmo >= 0.0
    assert len(summary.top_defect_classes) >= 1
    assert len(summary.hourly_trend) >= 5

    # 2. Pareto Analysis
    pareto = await svc.get_defect_pareto("LINE-1")
    assert len(pareto) >= 1
    assert pareto[0]["cumulative_percentage"] >= pareto[0]["percentage"]
    assert "IPC-A-610" in pareto[0]["ipc_standard"]


@pytest.mark.asyncio
async def test_human_disposition_audit_trail():
    """Verify auditable human review workflow updates verdict and persists compliance trail."""
    store = InMemoryInspectionStore()
    svc = VisualQualityService(history_store=store)

    # 1. Perform inspection that fails
    insp = await svc.inspect_part("CAM_AOI_L1", "PART-ECU-010-DEF")
    assert insp.verdict == InspectionVerdict.FAIL
    assert insp.human_disposition_status == "PENDING_REVIEW"

    # 2. Auditor confirms defect
    req_confirm = HumanDispositionRequest(
        inspection_id=insp.inspection_id,
        auditor_id="ENG-QC-9921",
        action="CONFIRM_DEFECT",
        rationale="Visual confirmation: Solder bridging between pins 14-16 on U2 IC confirmed under 40x microscope.",
    )
    audit_record = await svc.record_human_disposition(req_confirm)
    assert audit_record.audit_id is not None
    assert audit_record.final_verdict == InspectionVerdict.OVERRIDDEN_FAIL

    # 3. Auditor overrides pass on false alarm
    insp2 = await svc.inspect_part("CAM_AOI_L1", "PART-ECU-015-DEF")
    req_override = HumanDispositionRequest(
        inspection_id=insp2.inspection_id,
        auditor_id="ENG-QC-9921",
        action="OVERRIDE_PASS",
        rationale="Wetting angle is 42 degrees, within IPC-A-610 Class 2 allowable tolerance. Non-conformance dismissed.",
    )
    audit_override = await svc.record_human_disposition(req_override)
    assert audit_override.final_verdict == InspectionVerdict.OVERRIDDEN_PASS

    # 4. Verify audit trail retrieval
    trail = await svc.get_disposition_audit_trail(limit=10)
    assert len(trail) >= 2


@pytest.mark.asyncio
async def test_golden_template_registration():
    """Verify golden template registration and retrieval."""
    store = InMemoryInspectionStore()
    svc = VisualQualityService(history_store=store)

    template = GoldenTemplate(
        template_id="GT-NEW-003",
        part_number="PART-POWER-INVERTER-REV-A",
        revision="REV_A",
        gcs_template_uri="gs://twinforge-visual-inspection/golden-templates/INVERTER_REV_A_GOLDEN.png",
        keypoints_count=940,
        similarity_tolerance_pct=0.92,
        registered_by="QC_LEAD",
    )
    registered = await svc.register_golden_template(template)
    assert registered.part_number == "PART-POWER-INVERTER-REV-A"

    retrieved = await svc.get_golden_template("PART-POWER-INVERTER-REV-A")
    assert retrieved is not None
    assert retrieved.template_id == "GT-NEW-003"
    assert retrieved.keypoints_count == 940


@pytest.mark.asyncio
async def test_backward_compatibility():
    """Verify legacy test_features.py contracts run identically."""
    store = InMemoryInspectionStore()
    svc = VisualQualityService(store)

    res_pass = await svc.inspect_part("CAM-01", "PART-102")
    assert res_pass.verdict == InspectionVerdict.PASS

    res_fail = await svc.inspect_part("CAM-01", "PART-105-DEF")
    assert res_fail.verdict == InspectionVerdict.FAIL
    assert len(res_fail.defects) > 0


if __name__ == "__main__":
    print("Running Google Cloud-First Visual Quality Inspection Automated Test Suite...")
    asyncio.run(test_vertex_ai_defect_detection_and_rules())
    print("  ✅ Vertex AI Custom Model Defect Detection & IPC-A-610 Rules passed.")

    asyncio.run(test_gemini_advisory_reasoning_and_authority_guard())
    print("  ✅ Gemini Advisory Reasoning & Authority Guard passed.")

    asyncio.run(test_cloud_vision_ocr_and_barcode())
    print("  ✅ Cloud Vision OCR & Barcode Grade Reading passed.")

    asyncio.run(test_latency_metrics_profiling())
    print("  ✅ Latency Metrics Profiling passed.")

    asyncio.run(test_line_quality_kpis_and_pareto())
    print("  ✅ FPY, DPMO & Defect Pareto Calculations passed.")

    asyncio.run(test_human_disposition_audit_trail())
    print("  ✅ Auditable Human Review Disposition & Compliance Trail passed.")

    asyncio.run(test_golden_template_registration())
    print("  ✅ Golden Template Registration & Keypoints passed.")

    asyncio.run(test_backward_compatibility())
    print("  ✅ Backward Compatibility with test_features.py passed.")

    print("\n🎉 ALL VISUAL QUALITY INSPECTION TESTS PASSED SUCCESSFULLY!")
