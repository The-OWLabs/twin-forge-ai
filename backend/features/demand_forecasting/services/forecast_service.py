"""Demand forecasting service using configurable forecast horizons and multipliers."""
from typing import Optional
from backend.features.demand_forecasting.ports.contracts import (
    IDemandForecastingUseCase,
    IOrderHistoryReader,
)
from backend.features.demand_forecasting.domain.models import (
    ProbabilisticForecast,
    CapacityHeadroomReport,
)
from backend.features.demand_forecasting.config.models import (
    DemandConfigStore,
    demand_config_store,
)


class DemandForecastingService(IDemandForecastingUseCase):
    def __init__(
        self,
        history_reader: IOrderHistoryReader,
        config_store: Optional[DemandConfigStore] = None,
    ) -> None:
        self.reader = history_reader
        self.config_store = config_store or demand_config_store

    async def forecast_product_demand(self, product_id: str, horizon_weeks: Optional[int] = None) -> ProbabilisticForecast:
        cfg = self.config_store.get_config()
        horizon = horizon_weeks if horizon_weeks is not None else cfg.default_horizon_weeks

        history = await self.reader.get_historical_demand(product_id)
        avg_demand = sum(history) / len(history) if history else 1200.0

        p50 = round(avg_demand * horizon * cfg.growth_trend_multiplier, 1)
        p10 = round(p50 * cfg.p10_uncertainty_factor, 1)
        p90 = round(p50 * cfg.p90_uncertainty_factor, 1)

        trend = "INCREASING" if p50 > (avg_demand * horizon) else "STABLE"

        return ProbabilisticForecast(
            product_id=product_id,
            horizon_weeks=horizon,
            p10_units=p10,
            p50_units=p50,
            p90_units=p90,
            trend_direction=trend,
        )

    async def check_capacity_headroom(self, line_id: str, horizon_weeks: Optional[int] = None) -> CapacityHeadroomReport:
        cfg = self.config_store.get_config()
        horizon = horizon_weeks if horizon_weeks is not None else cfg.default_horizon_weeks

        rated_weekly_cap = await self.reader.get_line_rated_capacity(line_id)
        total_capacity = rated_weekly_cap * horizon

        forecast = await self.forecast_product_demand(product_id="ECU-200", horizon_weeks=horizon)
        headroom = total_capacity - forecast.p50_units
        utilization = (forecast.p50_units / total_capacity * 100.0) if total_capacity > 0 else 100.0

        return CapacityHeadroomReport(
            line_id=line_id,
            total_capacity_units=total_capacity,
            forecasted_demand_units=forecast.p50_units,
            headroom_units=round(headroom, 1),
            utilization_pct=round(utilization, 1),
            is_capacity_exceeded=utilization >= cfg.capacity_warning_threshold_pct,
        )
