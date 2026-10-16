"""Unit tests for all 7 feature domain services."""
import pytest
from backend.features.predictive_maintenance.services.maintenance_service import PredictiveMaintenanceService
from backend.features.predictive_maintenance.adapters.mock_telemetry import InMemoryTelemetryReader
from backend.features.predictive_maintenance.domain.models import ISO10816Severity

from backend.features.visual_quality_inspection.services.quality_service import VisualQualityService
from backend.features.visual_quality_inspection.adapters.in_memory_store import InMemoryInspectionStore
from backend.features.visual_quality_inspection.domain.models import InspectionVerdict

from backend.features.production_optimization.services.optimization_service import ProductionOptimizationService
from backend.features.production_optimization.adapters.mock_line_reader import InMemoryLineStateReader

from backend.features.supply_chain_intelligence.services.supply_service import SupplyChainService
from backend.features.supply_chain_intelligence.adapters.in_memory_inventory import InMemoryERPReader

from backend.features.demand_forecasting.services.forecast_service import DemandForecastingService
from backend.features.demand_forecasting.adapters.mock_order_reader import InMemoryOrderReader

from backend.features.waste_reduction.services.waste_service import WasteReductionService
from backend.features.waste_reduction.adapters.mock_scrap_reader import InMemoryScrapMetricsReader

from backend.features.operational_copilots.services.copilot_service import OperationalCopilotService
from backend.features.operational_copilots.adapters.mock_shift_reader import InMemoryShiftLogReader

from backend.agents.orchestrator.coordinator import SwarmCoordinator


@pytest.mark.asyncio
async def test_predictive_maintenance():
    svc = PredictiveMaintenanceService(InMemoryTelemetryReader())
    report = await svc.diagnose_asset("A-ROB-03")
    assert report.asset_id == "A-ROB-03"
    assert report.health.vibration_rms == 5.4
    assert report.health.iso_zone == ISO10816Severity.ZONE_C_UNSATISFACTORY
    assert report.rul.hours_to_trip > 0.0


@pytest.mark.asyncio
async def test_visual_quality():
    svc = VisualQualityService(InMemoryInspectionStore())
    res_pass = await svc.inspect_part("CAM-01", "PART-102")
    assert res_pass.verdict == InspectionVerdict.PASS

    res_fail = await svc.inspect_part("CAM-01", "PART-105-DEF")
    assert res_fail.verdict == InspectionVerdict.FAIL
    assert len(res_fail.defects) > 0


@pytest.mark.asyncio
async def test_production_optimization():
    svc = ProductionOptimizationService(InMemoryLineStateReader())
    oee = await svc.compute_oee("LINE-A")
    assert oee.overall_oee_pct > 0.0
    throughput = await svc.analyze_line_throughput("LINE-A")
    assert throughput.bottleneck.asset_id == "A-ROB-03"


@pytest.mark.asyncio
async def test_supply_chain():
    svc = SupplyChainService(InMemoryERPReader())
    risk = await svc.evaluate_stockout_risk("CMP-MCU-01")
    assert risk.stock_on_hand == 380
    po = await svc.generate_po_recommendation("CMP-MCU-01")
    assert po.suggested_order_qty >= 500


@pytest.mark.asyncio
async def test_demand_forecasting():
    svc = DemandForecastingService(InMemoryOrderReader())
    forecast = await svc.forecast_product_demand("ECU-200")
    assert forecast.p50_units > forecast.p10_units
    assert forecast.p90_units > forecast.p50_units


@pytest.mark.asyncio
async def test_waste_reduction():
    svc = WasteReductionService(InMemoryScrapMetricsReader())
    scrap = await svc.attribute_scrap("LINE-A")
    assert scrap.total_scrap_units > 0
    assert scrap.top_root_cause_asset == "A-ROB-03"

    energy = await svc.evaluate_machine_energy_waste("A-ROB-03")
    assert energy.friction_waste_kw == 2.2


@pytest.mark.asyncio
async def test_operational_copilot():
    svc = OperationalCopilotService(InMemoryShiftLogReader())
    sop = await svc.get_sop_step("SOP-LOTO-01", 1)
    assert "Lockout" in sop.title
    handover = await svc.generate_shift_handover("LINE-A", "Morning Shift")
    assert handover.units_produced == 1420


@pytest.mark.asyncio
async def test_swarm_coordinator():
    coord = SwarmCoordinator()
    plan = await coord.run_crisis_investigation("LINE-A", "A-ROB-03")
    assert plan.target_asset == "A-ROB-03"
    assert "REROUTE_AND_MAINTAIN" in plan.proposed_action
    assert plan.requires_human_approval is True
