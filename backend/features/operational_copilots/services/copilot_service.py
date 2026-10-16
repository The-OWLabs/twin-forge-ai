"""Operational copilot service for SOP step guidance, shift reports, and alarm triage."""
from backend.features.operational_copilots.ports.contracts import (
    IOperationalCopilotUseCase,
    IShiftLogReader,
)
from backend.features.operational_copilots.domain.models import (
    SOPStep,
    ShiftHandoverReport,
    AlarmDiagnostic,
)


class OperationalCopilotService(IOperationalCopilotUseCase):
    def __init__(self, log_reader: IShiftLogReader) -> None:
        self.reader = log_reader

    async def get_sop_step(self, procedure_id: str, step_number: int) -> SOPStep:
        # Step lookup for changeovers / maintenance
        return SOPStep(
            step_number=step_number,
            title="Lockout / Tagout (LOTO) & Bearing Decoupling",
            instruction="Isolate 480V main power disconnect breaker switch Q1. Attach safety padlock and verify zero energy state with multimeter.",
            safety_warning="DANGER: Arc flash hazard. Wear Level 2 arc flash shield and insulated gloves.",
            required_tools=["Torque Wrench 45 Nm", "Fluke Multimeter", "Lockout Padlock #4"],
        )

    async def generate_shift_handover(self, line_id: str, shift_name: str) -> ShiftHandoverReport:
        units, scrap_pct, incidents = await self.reader.get_shift_metrics(line_id)

        return ShiftHandoverReport(
            line_id=line_id,
            shift_name=shift_name,
            units_produced=units,
            scrap_rate_pct=scrap_pct,
            major_incidents=incidents,
            pending_work_orders=["WO-2026-88: Bearing replacement for A-ROB-03"],
            next_shift_priorities=[
                "Monitor vibration on robot cell 2 after changeover",
                "Replenish SMT component reel CMP-PWR-04",
            ],
        )

    async def diagnose_alarm(self, asset_id: str, alarm_code: str) -> AlarmDiagnostic:
        return AlarmDiagnostic(
            alarm_code=alarm_code,
            asset_id=asset_id,
            severity="CRITICAL",
            description=f"High vibration excursion detected on {asset_id} joint 2 actuator.",
            recommended_troubleshooting_steps=[
                "Halt line before trip threshold breach.",
                "Inspect harmonic drive gearbox for metal shavings or grease degradation.",
                "Perform mechanical backlash verification test.",
            ],
            relevant_manual_section="AX6 Technical Service Bulletin Sec 4.2: Drive Maintenance",
        )
