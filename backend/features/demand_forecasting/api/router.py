"""FastAPI router for demand forecasting."""
from fastapi import APIRouter
from backend.features.demand_forecasting.services.forecast_service import DemandForecastingService
from backend.features.demand_forecasting.adapters.mock_order_reader import InMemoryOrderReader
from backend.features.demand_forecasting.domain.models import ProbabilisticForecast, CapacityHeadroomReport

router = APIRouter(prefix="/demand", tags=["Demand Forecasting"])

_reader = InMemoryOrderReader()
_service = DemandForecastingService(_reader)


@router.get("/forecast/{product_id}", response_model=ProbabilisticForecast)
async def get_demand_forecast(product_id: str, horizon_weeks: int = 4) -> ProbabilisticForecast:
    """Generate probabilistic multi-horizon demand projection."""
    return await _service.forecast_product_demand(product_id, horizon_weeks)


@router.get("/headroom/{line_id}", response_model=CapacityHeadroomReport)
async def get_capacity_headroom(line_id: str, horizon_weeks: int = 4) -> CapacityHeadroomReport:
    """Compare forecasted demand against maximum factory capacity."""
    return await _service.check_capacity_headroom(line_id, horizon_weeks)
