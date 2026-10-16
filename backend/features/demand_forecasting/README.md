# Demand Forecasting Domain (`backend/features/demand_forecasting`)

## 1. Domain Overview & Purpose
The **Demand Forecasting** module produces probabilistic, multi-horizon forecasts of product demand. By synchronizing customer order backlogs, seasonal trends, and macroeconomic indicators with factory capacity, it ensures manufacturing operations plan production runs without bullwhip effects or excess inventory carrying costs.

---

## 2. Domain Models & Mathematical Foundations

### Core Entities & Value Objects (`domain/`)
- `DemandTimeSeries`: Timestamped historical sales, confirmed purchase orders, and quotations.
- `ProbabilisticForecast`: Point forecasts alongside confidence bands ($P_{10}, P_{50}, P_{90}$).
- `BacklogConsumptionRate`: Pacing at which open customer orders consume scheduled capacity.
- `MonteCarloScenario`: Simulated demand trajectories under volatile market conditions.

### Capacity Headroom Formula
$$\text{Capacity Headroom}(t) = \text{Max Line Capacity}(t) - \sum \text{Forecasted Demand}_i(t) \times \text{Cycle Time}_i$$

---

## 3. Ports & Contracts (`ports/`)

### Driving Ports (`ports/input/`)
- `IDemandForecastingUseCase`:
  - `generate_sku_forecast(product_id: str, horizon_weeks: int) -> ProbabilisticForecast`
  - `evaluate_capacity_headroom(plant_id: str, horizon_weeks: int) -> CapacityHeadroomReport`
  - `run_demand_scenario(parameters: ScenarioParams) -> ScenarioOutcome`

### Driven Ports (`ports/output/`)
- `IHistoricalOrderRepository`: Reads historical shipment volumes and open order books.
- `IForecastingModelInference`: Runs forecasting algorithms (Temporal Fusion Transformer, Prophet, LightGBM).
- `ICapacityCalendarAdapter`: Reads planned shift schedules, holidays, and maintenance blackouts.

---

## 4. MCP Tools & Agent Interfaces
- `get_product_demand_forecast(product_id, horizon)`: Returns $P_{10}/P_{50}/P_{90}$ demand projections.
- `evaluate_plant_headroom(line_id)`: Checks if forecast exceeds safe operational capacity.
- `simulate_demand_surge(percentage)`: Assesses factory delivery risk under sudden order spikes.
