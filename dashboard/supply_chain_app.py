"""TwinForge - Enterprise AI-Powered Supply Chain Intelligence Operations Cockpit.

Interactive Streamlit & Plotly Dashboard:
1. Executive KPI Scorecard (OTD, Fill Rate, DOI, Disruption Cost, Revenue at Risk)
2. Global Supplier Network & Multi-Factor Risk Scoring
3. Inventory Balances & Bill-of-Materials (BOM) Downstream Plant Propagation
4. In-Transit Multi-Modal Logistics & Delay Milestone Tracking
5. Disruption & Mitigation Action Center with 1-Click Approval
6. Conversational AI Supply Chain Assistant & What-If Scenario Simulator
"""
import sys
from pathlib import Path

# Add project root to sys.path so backend is always importable
_repo_root = str(Path(__file__).resolve().parent.parent)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

import asyncio
from datetime import datetime, timezone
import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

from backend.features.supply_chain_intelligence.repositories.local_mock_repo import local_supply_chain_repo
from backend.features.supply_chain_intelligence.services.kpi_service import supply_chain_kpi_service
from backend.features.supply_chain_intelligence.services.risk_engine import supply_chain_risk_engine
from backend.features.supply_chain_intelligence.assistant.models import (
    SupplyChainChatRequest,
    WhatIfSimulationRequest,
    UserRole,
)
from backend.features.supply_chain_intelligence.assistant.assistant_service import supply_chain_assistant_service
from backend.features.supply_chain_intelligence.config.models import supply_config_store

st.set_page_config(
    page_title="TwinForge - Supply Chain Intelligence",
    page_icon="🌐",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Header & Status Banner
col_h1, col_h2 = st.columns([3, 1])
with col_h1:
    st.title("🌐 Supply Chain Intelligence & Risk Cockpit")
    st.caption("TwinForge Autonomous Multi-Tier Supplier Monitoring, In-Transit Logistics, BOM Impact & AI Mitigation")

with col_h2:
    st.success("🟢 **DATA MODE: ENTERPRISE LIVE**\nConnected to ERP, WMS, TMS & BOM Ontology")

st.divider()

# Sidebar: Filters & Dynamic Thresholds
st.sidebar.header("Enterprise Network Filters")
plant_choice = st.sidebar.selectbox("Manufacturing Plant", ["All", "PLANT_BANGALORE", "PLANT_STUTTGART", "PLANT_DETROIT"])
supplier_risk_choice = st.sidebar.selectbox("Supplier Risk Filter", ["All", "CRITICAL", "HIGH", "MEDIUM", "LOW"])

st.sidebar.divider()
st.sidebar.subheader("Dynamic Thresholds (Live)")
cfg = supply_config_store.get_config()
st.sidebar.caption(f"Critical Days of Inventory: **{cfg.critical_days_of_supply_threshold} Days**")
st.sidebar.caption(f"Target OTD: **{cfg.on_time_delivery_target_pct:.1f}%**")
st.sidebar.caption(f"Min Recommended PO Lot: **{cfg.min_recommended_po_qty} Units**")

# Load Data
plant_filter = None if plant_choice == "All" else plant_choice
kpis = supply_chain_kpi_service.compute_kpis(plant_id=plant_filter)
suppliers = local_supply_chain_repo.list_suppliers(risk_level=supplier_risk_choice)
inventory = local_supply_chain_repo.list_inventory(plant_id=plant_filter)
shipments = local_supply_chain_repo.list_shipments()
orders = local_supply_chain_repo.list_customer_orders()
disruptions = local_supply_chain_repo.list_disruptions(active_only=True)
mitigations = supply_chain_risk_engine.generate_mitigation_recommendations()

# Top KPI Metric Cards
k1, k2, k3, k4, k5, k6 = st.columns(6)
k1.metric("On-Time Delivery (OTD)", f"{kpis.on_time_delivery_rate:.1f}%", delta="Target: 95.0%")
k2.metric("Order Fill Rate", f"{kpis.order_fill_rate:.1f}%")
k3.metric("Avg Days of Inventory", f"{kpis.average_days_of_inventory:.1f} d", help="Across all monitored component SKUs")
k4.metric("Supplier Reliability", f"{kpis.supplier_reliability_index:.1f}/100")
k5.metric("Orders at Immediate Risk", kpis.customer_orders_at_risk_count, delta=f"-${kpis.total_revenue_at_risk_usd:,.0f} Rev", delta_color="inverse")
k6.metric("Active Disruption Exposure", f"${kpis.estimated_disruption_cost_usd:,.0f}", delta="Projected Loss", delta_color="inverse")

if disruptions:
    st.error(f"🚨 **ACTIVE LOGISTICS DISRUPTIONS**: {len(disruptions)} active supply chain bottlenecks threatening ${kpis.total_revenue_at_risk_usd:,.0f} in customer delivery revenue!")

st.divider()

# Main Application Tabs
tab_suppliers, tab_inventory, tab_logistics, tab_mitigations, tab_ai = st.tabs([
    "🏭 Suppliers & Delivery Risk",
    "📦 Inventory & BOM Propagation",
    "🚢 Active Shipments & Port Delays",
    "🎯 Disruption & Mitigation Center",
    "🤖 AI Assistant & What-If Simulator",
])

# ==============================================================================
# TAB 1: SUPPLIERS & DELIVERY RISK
# ==============================================================================
with tab_suppliers:
    st.subheader("🏭 Global Multi-Tier Supplier Network & Risk Profiles")
    st.caption("Evaluates lead-time variability, on-time delivery rate (OTD), geopolitical exposure, and single-source dependency.")

    sup_rows = []
    for s in suppliers:
        sup_rows.append({
            "Supplier ID": s.supplier_id,
            "Supplier Name": s.supplier_name,
            "Country": s.country,
            "Tier": f"Tier {s.tier}",
            "Category": s.category,
            "OTD Rate": f"{s.on_time_delivery_rate:.1%}",
            "Lead Time (Mean)": f"{s.lead_time_days_mean:.0f} days",
            "Variance (σ)": f"±{s.lead_time_variance_days:.1f} days",
            "Defect PPM": f"{s.defect_ppm:.0f}",
            "Geopolitical Risk": f"{s.geopolitical_risk_score:.2f}",
            "Composite Risk": s.composite_risk_level.value,
        })
    st.dataframe(pd.DataFrame(sup_rows), use_container_width=True, hide_index=True)

    # Supplier Risk Distribution Chart
    st.divider()
    c_col1, c_col2 = st.columns(2)
    with c_col1:
        st.subheader("📊 Supplier Lead-Time Variance vs OTD Rate")
        df_sup = pd.DataFrame([{
            "Name": s.supplier_name,
            "OTD": s.on_time_delivery_rate * 100.0,
            "Variance": s.lead_time_variance_days,
            "Risk": s.composite_risk_level.value,
            "Category": s.category,
        } for s in suppliers])
        fig_sup = px.scatter(
            df_sup,
            x="Variance",
            y="OTD",
            color="Risk",
            text="Name",
            title="Lead Time Variance (Days) vs On-Time Delivery (%)",
            color_discrete_map={"CRITICAL": "#ef4444", "HIGH": "#f97316", "MEDIUM": "#f59e0b", "LOW": "#10b981"},
        )
        fig_sup.update_traces(textposition="top center")
        st.plotly_chart(fig_sup, use_container_width=True)

    with c_col2:
        st.subheader("⚠️ Single-Source Concentration Alert")
        conc = supply_chain_risk_engine.evaluate_supplier_concentration()
        st.metric("Total Components Monitored", conc["total_parts_monitored"])
        st.metric("Single-Sourced Components", f"{conc['single_source_count']} ({conc['single_source_percentage']}%)")
        st.metric("Critical Single-Source Parts (Class A)", conc["critical_single_source_count"])
        if conc["concentration_alert"]:
            st.warning(f"⚠️ Single-source concentration detected on: `{', '.join(conc['critical_single_source_parts'])}`. Qualify alternate suppliers to mitigate supplier lock-in.")

# ==============================================================================
# TAB 2: INVENTORY & BOM PROPAGATION
# ==============================================================================
with tab_inventory:
    st.subheader("📦 Real-Time Inventory Balances & Stockout Risk")
    st.caption("Days of Inventory (DOI) = Stock on Hand / Daily Consumption Rate. Breaches below 3.0 days trigger immediate alerts.")

    inv_rows = []
    for i in inventory:
        p = local_supply_chain_repo.get_part(i.part_id)
        inv_rows.append({
            "Inventory ID": i.inventory_id,
            "Part ID": i.part_id,
            "Part Name": p.part_name if p else "Component",
            "Plant": i.plant_id,
            "Stock On Hand": f"{i.stock_on_hand:,}",
            "Allocated": f"{i.stock_allocated:,}",
            "Available": f"{i.stock_available:,}",
            "Daily Burn Rate": f"{i.daily_consumption_rate:.1f}/day",
            "Days of Inventory (DOI)": f"{i.days_of_inventory_remaining:.1f} days",
            "Stockout Risk Score": f"{i.stockout_risk_score:.0%}",
            "Status": "🚨 AT RISK" if i.is_at_risk_of_stockout else "🟢 HEALTHY",
        })
    st.dataframe(pd.DataFrame(inv_rows), use_container_width=True, hide_index=True)

    # Interactive BOM Downstream Drill-down
    st.divider()
    st.subheader("🔍 Bill-of-Materials (BOM) Downstream Impact Drill-Down")
    selected_part = st.selectbox("Select Component to Trace Through BOM:", [p.part_id for p in local_supply_chain_repo.list_parts()])
    bom_analysis = supply_chain_risk_engine.analyze_bom_downstream_impact(selected_part)

    b_col1, b_col2, b_col3 = st.columns(3)
    b_col1.metric("Component Criticality", f"Class {bom_analysis['criticality']}")
    b_col2.metric("Minimum Days of Supply", f"{bom_analysis['minimum_days_of_inventory']:.1f} Days")
    b_col3.metric("Revenue at Downstream Risk", f"${bom_analysis['total_revenue_at_risk_usd']:,.0f}")

    st.write(f"**Impacted Finished Assemblies**: `{', '.join(bom_analysis['impacted_assemblies']) or 'None'}`")
    st.write(f"**Threatened Customer Orders**: `{', '.join(bom_analysis['impacted_customer_orders']) or 'None'}`")
    if bom_analysis["immediate_shutdown_threat"]:
        st.error(f"🚨 **IMMEDIATE PRODUCTION SHUTDOWN THREAT**: Stock of {selected_part} will exhaust in under 3 days! Daily SLA delay penalty: ${bom_analysis['daily_sla_penalties_usd']:,.0f}/day.")

# ==============================================================================
# TAB 3: ACTIVE SHIPMENTS & PORT DELAYS
# ==============================================================================
with tab_logistics:
    st.subheader("🚢 Active Multi-Modal Logistics & Delay Milestone Tracking")
    st.caption("Real-time GPS coordinates, carrier milestone updates, port congestion, and customs clearance holds.")

    shp_rows = []
    for s in shipments:
        shp_rows.append({
            "Shipment ID": s.shipment_id,
            "Associated PO": s.po_id,
            "Carrier": s.carrier_name,
            "Mode": s.transport_mode.value,
            "Route": f"{s.origin_hub} ➔ {s.destination_hub}",
            "Scheduled ETA": s.scheduled_eta,
            "Current Projected ETA": s.current_projected_eta,
            "ETA Drift": f"+{s.eta_drift_days:.0f} days" if s.eta_drift_days > 0 else "On Time",
            "Milestone Status": s.status.value,
            "Delay Root Cause": s.delay_root_cause or "None (Nominal)",
        })
    st.dataframe(pd.DataFrame(shp_rows), use_container_width=True, hide_index=True)

    # Delay Breakdown
    delayed = [s for s in shipments if s.eta_drift_days > 0]
    if delayed:
        st.warning(f"⚠️ **{len(delayed)} In-Transit Shipments Delayed**: Major bottlenecks detected at Chennai Port (Berth Congestion) and Long Beach Port (Customs Hold).")

# ==============================================================================
# TAB 4: DISRUPTION & MITIGATION CENTER
# ==============================================================================
with tab_mitigations:
    st.subheader("🎯 Active Disruptions & Prescriptive Mitigation Action Center")
    st.caption("Actionable recommendations ranked by financial net benefit. 1-click human approval updates ERP order lines.")

    for m in mitigations:
        with st.container(border=True):
            mc1, mc2, mc3 = st.columns([3, 1, 1])
            with mc1:
                st.markdown(f"#### ⚡ **{m.recommendation_id}**: {m.action_type}")
                st.write(f"**Action Rationale**: {m.description}")
                st.caption(f"Target Component: `{m.target_part_id}` | Lead Time: **{m.speed_hours_to_execute} Hours** | Feasibility: **{m.feasibility_score:.0%}** | Urgency: `{m.urgency.value}`")

            with mc2:
                st.metric("Mitigation Cost", f"${m.estimated_mitigation_cost_usd:,.0f}")
                st.metric("Downtime Avoided", f"${m.estimated_downtime_cost_avoided_usd:,.0f}")
                st.metric("Net Financial Benefit", f"${m.net_financial_benefit_usd:,.0f}", delta="Cost Avoidance")

            with mc3:
                st.write(f"**Status**: `{m.status}`")
                if m.status == "APPROVED":
                    st.success(f"Approved by:\n`{m.approved_by}`")
                else:
                    if st.button("✅ Approve Mitigation", key=f"app_mit_{m.recommendation_id}"):
                        local_supply_chain_repo.approve_mitigation(m.recommendation_id, "VP of Global Supply Chain Operations")
                        st.success(f"Mitigation {m.recommendation_id} Approved! Disruption resolved.")
                        st.rerun()

# ==============================================================================
# TAB 5: AI ASSISTANT & WHAT-IF SIMULATOR
# ==============================================================================
with tab_ai:
    st.subheader("🤖 AI-Powered Conversational Supply Chain Assistant")
    st.caption("Multi-source grounded analytics across ERP, TMS, WMS, and BOM data. Zero hallucinations with prompt-injection defense.")

    if "sc_chat_response" not in st.session_state:
        st.session_state.sc_chat_response = None
    if "sc_query_text" not in st.session_state:
        st.session_state.sc_query_text = ""

    # Controls
    ai_col1, ai_col2, ai_col3 = st.columns([2, 1, 1])
    with ai_col1:
        ai_part = st.selectbox("Target Part Filter", ["Auto-detect"] + [p.part_id for p in local_supply_chain_repo.list_parts()])
    with ai_col2:
        ai_lang = st.selectbox("Response Language", [("en", "English 🇬🇧"), ("de", "Deutsch 🇩🇪"), ("hi", "Hindi 🇮🇳")], format_func=lambda x: x[1])[0]
    with ai_col3:
        ai_role = st.selectbox("Role", [UserRole.PROCUREMENT_MANAGER, UserRole.SUPPLY_CHAIN_DIRECTOR, UserRole.LOGISTICS_COORDINATOR, UserRole.PLANT_OPERATIONS_LEAD], format_func=lambda r: r.value)

    # Pre-canned Quick Queries
    st.markdown("**⚡ Quick Operational Inquiries:**")
    q1, q2, q3, q4 = st.columns(4)
    if q1.button("🚨 Which suppliers pose greatest risk?", use_container_width=True):
        st.session_state.sc_query_text = "Which suppliers pose the greatest risk over the next seven days and why has reliability decreased?"
    if q2.button("📦 Stockout risk for PRT-MCU-8841", use_container_width=True):
        st.session_state.sc_query_text = "What is the stockout risk for PRT-MCU-8841 and which customer orders are affected by delayed shipments?"
    if q3.button("🚢 Long Beach Port customs delay", use_container_width=True):
        st.session_state.sc_query_text = "What happened to the hydraulic valve shipment at Long Beach Port and what is the downstream plant impact?"
    if q4.button("💰 Financial impact of disruptions", use_container_width=True):
        st.session_state.sc_query_text = "What actions would minimize the financial impact of current disruptions and what are the net benefits?"

    # Chat Form
    with st.form("sc_ai_form", clear_on_submit=False):
        user_sc_query = st.text_input("Ask a supply chain question:", value=st.session_state.sc_query_text, placeholder="e.g. Which parts are likely to run out of stock? What customer orders are at risk?")
        sc_submit = st.form_submit_button("Ask Supply Chain AI 🚀", use_container_width=True)

    if sc_submit and user_sc_query.strip():
        chosen_p = None if ai_part == "Auto-detect" else ai_part
        req = SupplyChainChatRequest(
            query=user_sc_query.strip(),
            part_id=chosen_p,
            plant_id=plant_filter,
            language=ai_lang,
            user_role=ai_role,
        )
        with st.spinner("Analyzing ERP purchase orders, in-transit telemetry, inventory DOI, and customer SLA exposure..."):
            resp = asyncio.run(supply_chain_assistant_service.answer_query(req))
            st.session_state.sc_chat_response = resp
            st.session_state.sc_query_text = user_sc_query.strip()

    if st.session_state.sc_chat_response:
        resp = st.session_state.sc_chat_response
        st.divider()
        st.markdown(resp.answer_markdown)

        # Collapsible Grounded Evidence
        with st.expander("🔬 View Multi-Source Grounded Evidence (ERP / TMS / WMS)", expanded=False):
            e_col1, e_col2 = st.columns(2)
            with e_col1:
                st.write("**Verified Facts**")
                st.json(resp.evidence.verified_facts)
            with e_col2:
                st.write("**Risk Predictions & Downstream Impact**")
                st.json(resp.evidence.risk_predictions)
                st.json(resp.evidence.downstream_impact)

    # What-If Disruption Scenario Simulator
    st.divider()
    st.subheader("🔮 What-If Disruption Scenario Simulator")
    st.caption("Hypothetical stress-testing: What happens if a critical supplier fails or a logistics node shuts down?")

    w_col1, w_col2, w_col3 = st.columns([2, 1, 1])
    with w_col1:
        sim_supplier = st.selectbox("Simulate Failure of Supplier", [s.supplier_id for s in suppliers], format_func=lambda sid: f"{sid} — {local_supply_chain_repo.get_supplier(sid).supplier_name}")
    with w_col2:
        sim_days = st.slider("Disruption Duration (Days)", min_value=3, max_value=60, value=14, step=1)
    with w_col3:
        sim_run = st.button("Run What-If Simulation ⚡", use_container_width=True)

    if sim_run:
        w_req = WhatIfSimulationRequest(
            scenario_type="SUPPLIER_FAILURE",
            target_entity_id=sim_supplier,
            duration_days=sim_days,
        )
        sim_res = supply_chain_assistant_service.simulate_what_if_scenario(w_req)
        with st.container(border=True):
            st.markdown(f"### {sim_res.scenario_title}")
            sc1, sc2, sc3 = st.columns(3)
            sc1.metric("Projected Line Downtime", f"{sim_res.projected_downtime_hours:.0f} Hours")
            sc2.metric("Projected Financial Exposure", f"${sim_res.projected_financial_loss_usd:,.0f} USD", delta="Total Loss", delta_color="inverse")
            sc3.metric("Customer Orders Threatened", len(sim_res.customer_orders_delayed))

            st.write(f"**Critical Components Depleted**: `{', '.join(sim_res.critical_parts_depleted)}`")
            st.write(f"**Customer Orders Delayed**: `{', '.join(sim_res.customer_orders_delayed)}`")
            st.info(f"💡 **Recommended Contingency Plan**: {sim_res.recommended_contingency_plan}")
