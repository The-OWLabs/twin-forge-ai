"""TwinForge Enterprise Backend - Main Application Entrypoint."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.core.config.settings import settings
from backend.features.predictive_maintenance.api.router import router as maint_router
from backend.features.visual_quality_inspection.api.router import router as quality_router
from backend.features.production_optimization.api.router import router as prod_router
from backend.features.supply_chain_intelligence.api.router import router as supply_router
from backend.features.demand_forecasting.api.router import router as demand_router
from backend.features.waste_reduction.api.router import router as waste_router
from backend.features.operational_copilots.api.router import router as copilot_router

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Enterprise Industrial Intelligence Platform - Predictive Maintenance, Visual Inspection, Optimization, Supply Chain, and Copilots",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount all 7 feature routers
app.include_router(maint_router, prefix="/api/v1")
app.include_router(quality_router, prefix="/api/v1")
app.include_router(prod_router, prefix="/api/v1")
app.include_router(supply_router, prefix="/api/v1")
app.include_router(demand_router, prefix="/api/v1")
app.include_router(waste_router, prefix="/api/v1")
app.include_router(copilot_router, prefix="/api/v1")


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "HEALTHY", "app": settings.app_name}
