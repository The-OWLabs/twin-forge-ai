"""FastAPI router for supply chain intelligence with dynamic configuration."""
from fastapi import APIRouter
from backend.features.supply_chain_intelligence.services.supply_service import SupplyChainService
from backend.features.supply_chain_intelligence.adapters.in_memory_inventory import InMemoryERPReader
from backend.features.supply_chain_intelligence.domain.models import (
    PartStockRisk,
    SupplierRiskScore,
    PurchaseOrderRecommendation,
)
from backend.features.supply_chain_intelligence.config.models import (
    SupplyChainConfig,
    supply_config_store,
)

router = APIRouter(prefix="/supply-chain", tags=["Supply Chain Intelligence"])

_reader = InMemoryERPReader()
_service = SupplyChainService(_reader, supply_config_store)


@router.get("/stockout-risk/{part_number}", response_model=PartStockRisk)
async def get_stockout_risk(part_number: str) -> PartStockRisk:
    """Evaluate days of supply remaining and stockout probability."""
    return await _service.evaluate_stockout_risk(part_number)


@router.get("/supplier-risk/{supplier_id}", response_model=SupplierRiskScore)
async def get_supplier_risk(supplier_id: str) -> SupplierRiskScore:
    """Evaluate supplier delivery variance and risk level."""
    return await _service.evaluate_supplier_risk(supplier_id)


@router.post("/recommend-po/{part_number}", response_model=PurchaseOrderRecommendation)
async def recommend_po(part_number: str) -> PurchaseOrderRecommendation:
    """Generate dynamic replenishment purchase order recommendation."""
    return await _service.generate_po_recommendation(part_number)


@router.get("/config", response_model=SupplyChainConfig)
async def get_supply_config() -> SupplyChainConfig:
    """Get active supply chain intelligence configuration."""
    return supply_config_store.get_config()


@router.put("/config", response_model=SupplyChainConfig)
async def update_supply_config(config: SupplyChainConfig) -> SupplyChainConfig:
    """Update supply chain thresholds and lead parameters dynamically."""
    return supply_config_store.update_config(config)
