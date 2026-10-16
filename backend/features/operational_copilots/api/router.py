"""FastAPI router for operational copilots."""
from fastapi import APIRouter
from backend.features.operational_copilots.services.copilot_service import OperationalCopilotService
from backend.features.operational_copilots.adapters.mock_shift_reader import InMemoryShiftLogReader
from backend.features.operational_copilots.domain.models import (
    SOPStep,
    ShiftHandoverReport,
    AlarmDiagnostic,
)

router = APIRouter(prefix="/copilot", tags=["Operational Copilots"])

_reader = InMemoryShiftLogReader()
_service = OperationalCopilotService(_reader)


@router.get("/sop/{procedure_id}/{step_number}", response_model=SOPStep)
async def get_sop_step(procedure_id: str, step_number: int) -> SOPStep:
    """Retrieve verified step instructions and safety warnings."""
    return await _service.get_sop_step(procedure_id, step_number)


@router.get("/shift-handover/{line_id}", response_model=ShiftHandoverReport)
async def get_shift_handover(line_id: str, shift_name: str = "Morning Shift") -> ShiftHandoverReport:
    """Generate automated shift handover report."""
    return await _service.generate_shift_handover(line_id, shift_name)


@router.get("/alarm-triage/{asset_id}/{alarm_code}", response_model=AlarmDiagnostic)
async def triage_alarm(asset_id: str, alarm_code: str) -> AlarmDiagnostic:
    """Diagnose PLC/SCADA alarm code and retrieve OEM troubleshooting actions."""
    return await _service.diagnose_alarm(asset_id, alarm_code)
