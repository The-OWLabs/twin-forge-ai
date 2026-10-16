# Supply Chain Intelligence Domain (`backend/features/supply_chain_intelligence`)

## 1. Domain Overview & Purpose
The **Supply Chain Intelligence** module prevents production line starvation by monitoring raw material inventory, evaluating multi-tier supplier lead-time variance, calculating dynamic safety stock buffers, and recommending optimal purchase order replenishment strategies.

---

## 2. Domain Models & Mathematical Foundations

### Core Entities & Value Objects (`domain/`)
- `BillOfMaterials (BOM)`: Hierarchical graph mapping finished goods (FG) down to sub-assemblies and raw component part numbers with scrap factors.
- `InventoryBuffer`: Current stock-on-hand, stock-in-transit, safety stock, and reorder point:
  $$\text{Reorder Point (ROP)} = (d \times L) + SS$$
  $$\text{Safety Stock (SS)} = Z \times \sqrt{L \times \sigma_d^2 + d^2 \times \sigma_L^2}$$
  *(where $d$ = average demand, $L$ = average lead time, $\sigma_d$ = demand variance, $\sigma_L$ = lead time variance, $Z$ = service level factor).*
- `SupplierRiskScore`: Multi-factor score evaluating lead-time reliability, quality defect rate, geopolitical risk, and single-source dependency.

---

## 3. Ports & Contracts (`ports/`)

### Driving Ports (`ports/input/`)
- `ISupplyChainUseCase`:
  - `evaluate_part_stockout_risk(part_number: str, horizon_days: int) -> StockoutRiskReport`
  - `calculate_dynamic_safety_stock(part_number: str, target_service_level: float) -> float`
  - `recommend_purchase_orders() -> list[PurchaseOrderRecommendation]`

### Driven Ports (`ports/output/`)
- `IERPInventoryAdapter`: Interfaces with SAP/ERP to read real-time stock balances and open POs.
- `ISupplierTelemetryAdapter`: Ingests logistics carrier tracking updates and delivery milestones.
- `IPOEmitter`: Posts draft purchase orders for procurement approval.

---

## 4. MCP Tools & Agent Interfaces
- `check_inventory_headroom(part_number)`: Returns hours of run-time remaining before line starvation.
- `simulate_supplier_delay(supplier_id, delay_days)`: Assesses line impact if an inbound shipment is delayed.
- `recommend_replenishment_order(part_number)`: Calculates optimal lot size and required delivery date.
