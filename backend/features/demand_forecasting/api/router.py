"""FastAPI router for demand forecasting with dynamic configuration."""
from typing import Optional
from fastapi import APIRouter
from backend.features.demand_forecasting.services.forecast_service import DemandForecastingService
from backend.features.demand_forecasting.adapters.mock_order_reader import InMemoryOrderReader
from backend.features.demand_forecasting.domain.models import ProbabilisticForecast, CapacityHeadroomReport
from backend.features.demand_forecasting.config.models import (
    DemandForecastingConfig,
    demand_config_store,
)

router = APIRouter(prefix="/demand", tags=["Demand Forecasting"])

_reader = InMemoryOrderReader()
_service = DemandForecastingService(_reader, demand_config_store)


@router.get("/forecast/{product_id}", response_model=ProbabilisticForecast)
async def get_demand_forecast(product_id: str, horizon_weeks: Optional[int] = None) -> ProbabilisticForecast:
    """Generate probabilistic multi-horizon demand projection."""
    return await _service.forecast_product_demand(product_id, horizon_weeks)


@router.get("/headroom/{line_id}", response_model=CapacityHeadroomReport)
async def get_capacity_headroom(line_id: str, horizon_weeks: Optional[int] = None) -> CapacityHeadroomReport:
    """Compare forecasted demand against maximum factory capacity."""
    return await _service.check_capacity_headroom(line_id, horizon_weeks)


@router.get("/config", response_model=DemandForecastingConfig)
async def get_demand_config() -> DemandForecastingConfig:
    """Get active demand forecasting configuration."""
    return demand_config_store.get_config()


@router.put("/config", response_model=DemandForecastingConfig)
async def update_demand_config(config: DemandForecastingConfig) -> DemandForecastingConfig:
    """Update demand projection factors dynamically at runtime."""
    return demand_config_store.update_config(config)
