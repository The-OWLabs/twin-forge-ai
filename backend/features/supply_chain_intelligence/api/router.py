"""FastAPI router for supply chain intelligence."""
from fastapi import APIRouter
from backend.features.supply_chain_intelligence.services.supply_service import SupplyChainService
from backend.features.supply_chain_intelligence.adapters.in_memory_inventory import InMemoryERPReader
from backend.features.supply_chain_intelligence.domain.models import (
    PartStockRisk,
    SupplierRiskScore,
    PurchaseOrderRecommendation,
)

router = APIRouter(prefix="/supply-chain", tags=["Supply Chain Intelligence"])

_reader = InMemoryERPReader()
_service = SupplyChainService(_reader)


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
