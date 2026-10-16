"""Production optimization service implementing deterministic OEE and bottleneck detection."""
from backend.features.production_optimization.ports.contracts import (
    IProductionOptimizationUseCase,
    ILineStateReader,
)
from backend.features.production_optimization.domain.models import (
    OEEMetrics,
    LineThroughputAnalysis,
    BottleneckStation,
)


class ProductionOptimizationService(IProductionOptimizationUseCase):
    def __init__(self, line_reader: ILineStateReader) -> None:
        self.line_reader = line_reader

    async def compute_oee(self, line_id: str) -> OEEMetrics:
        operating_time, planned_time = await self.line_reader.get_operating_hours(line_id)
        good_count, total_count = await self.line_reader.get_production_counts(line_id)

        # Availability: Operating Time / Planned Production Time
        availability = (operating_time / planned_time) if planned_time > 0 else 1.0

        # Performance: Actual Throughput vs Ideal Throughput
        # Assuming nominal ideal cycle is 15s (240 units/hr)
        ideal_count = operating_time * 240.0
        performance = (total_count / ideal_count) if ideal_count > 0 else 1.0

        # Quality: Good Count / Total Count
        quality = (good_count / total_count) if total_count > 0 else 1.0

        overall = availability * performance * quality

        return OEEMetrics(
            line_id=line_id,
            availability_pct=round(min(100.0, availability * 100.0), 1),
            performance_pct=round(min(100.0, performance * 100.0), 1),
            quality_pct=round(min(100.0, quality * 100.0), 1),
            overall_oee_pct=round(min(100.0, overall * 100.0), 1),
        )

    async def analyze_line_throughput(self, line_id: str) -> LineThroughputAnalysis:
        cycle_times = await self.line_reader.get_machine_cycle_times(line_id)
        oee = await self.compute_oee(line_id)

        # Bottleneck has the longest cycle time (Theory of Constraints)
        sorted_stations = sorted(cycle_times.items(), key=lambda x: x[1], reverse=True)
        slowest_asset, slowest_ct = sorted_stations[0] if sorted_stations else ("UNKNOWN", 20.0)

        bottleneck = BottleneckStation(
            asset_id=slowest_asset,
            asset_name=f"Workstation {slowest_asset}",
            cycle_time_seconds=slowest_ct,
            utilization_pct=94.5,
            is_active_constraint=True,
            starvation_risk_downstream=0.85,
        )

        current_uph = round(3600.0 / slowest_ct, 1) if slowest_ct > 0 else 0.0
        target_uph = 220.0

        # Little's Law: WIP = Throughput * CycleTime
        wip = int(current_uph * (sum(cycle_times.values()) / 3600.0))

        return LineThroughputAnalysis(
            line_id=line_id,
            current_uph=current_uph,
            target_uph=target_uph,
            oee=oee,
            bottleneck=bottleneck,
            wip_units=max(12, wip),
        )
