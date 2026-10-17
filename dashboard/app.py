"""TwinForge - Siemens Senseye-Inspired Predictive Maintenance & ROI Intelligence Platform.

An enterprise operations and financial intelligence dashboard providing:
- Multi-source OT/IT connectivity (PLC, CMMS, MES, ERP) with data provenance tracking
- Fleet health monitoring and ISO 10816 vibration severity
- Senseye-style actionable maintenance advisories with human-in-the-loop signoff
- Auditable downtime cost avoidance, realized vs estimated savings, ROI, and payback period
"""
import sys
from pathlib import Path

# Add project root to sys.path so backend is always importable
_repo_root = str(Path(__file__).resolve().parent.parent)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timezone
import asyncio

from backend.features.predictive_maintenance.repositories.local_mock_repo import LocalMockMachineRepository
from backend.features.predictive_maintenance.services.machine_service import MachineService
from backend.features.predictive_maintenance.connectors.manager import source_system_manager
from backend.features.predictive_maintenance.services.canonical_mapping_service import canonical_mapping_service
from backend.features.predictive_maintenance.services.recommendation_engine import recommendation_engine
from backend.features.predictive_maintenance.services.roi_intelligence_service import roi_intelligence_service
from backend.features.predictive_maintenance.config.models import maintenance_config_store
from backend.features.predictive_maintenance.schemas.canonical_models import ApprovalStatus, RecommendationUrgency

st.set_page_config(
    page_title="TwinForge - Predictive Maintenance & ROI Intelligence",
    page_icon="⚙️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Initialize services
@st.cache_resource
def get_services():
    repo = LocalMockMachineRepository(num_machines=20, config_store=maintenance_config_store)
    mach_svc = MachineService(repo)
    return repo, mach_svc

repo, machine_service = get_services()

# Header & Provenance Status Banner
col_h1, col_h2 = st.columns([3, 1])
with col_h1:
    st.title("⚙️ Predictive Maintenance & ROI Intelligence")
    st.caption("Siemens Senseye-Inspired Industrial Condition Monitoring, Advisory Recommendations & Financial Ledger")

with col_h2:
    sources = source_system_manager.get_fleet_source_health()
    actual_active = source_system_manager.has_any_actual_sources()
    if actual_active:
        st.success("🟢 **DATA MODE: ACTUAL INDUSTRIAL FEED**\nConnected to live OT/IT systems")
    else:
        st.warning("🟡 **DATA MODE: SIMULATED (DEMO FALLBACK)**\nExplicitly labeled physics simulation")

st.divider()

# Sidebar: Filters & Configuration
st.sidebar.header("Fleet & Enterprise Filters")
plant_choice = st.sidebar.selectbox("Plant Location", ["All", "PLANT_BANGALORE", "PLANT_STUTTGART", "PLANT_DETROIT"])
risk_choice = st.sidebar.selectbox("Risk Level", ["All", "HIGH", "MEDIUM", "LOW"])
crit_choice = st.sidebar.selectbox("Asset Criticality", ["All", "A (Production Critical)", "B (Major Line)", "C (Balance of Plant)"])

st.sidebar.divider()
st.sidebar.subheader("Dynamic Thresholds (Live)")
cfg = maintenance_config_store.get_config()
st.sidebar.caption(f"ISO Zone A Max: {cfg.iso_thresholds.zone_a_good_max} mm/s")
st.sidebar.caption(f"ISO Zone B Max: {cfg.iso_thresholds.zone_b_acceptable_max} mm/s")
st.sidebar.caption(f"ISO Zone C Max: {cfg.iso_thresholds.zone_c_unsatisfactory_max} mm/s")
st.sidebar.caption(f"High-Risk Failure Prob: {cfg.high_risk_probability_threshold:.0%}")

# Load Fleet Data
plant_filter = None if plant_choice == "All" else plant_choice
risk_filter = None if risk_choice == "All" else risk_choice
all_machines = asyncio.run(machine_service.list_machines(plant_id=plant_filter, risk_category=risk_filter))

# Filter by Criticality if selected
if crit_choice != "All":
    crit_letter = crit_choice[0]
    all_machines = [
        m for m in all_machines
        if canonical_mapping_service.get_canonical_asset(m["machine_id"]) and
        canonical_mapping_service.get_canonical_asset(m["machine_id"]).criticality.value == crit_letter
    ]

# Generate recommendations & ROI
recommendations = recommendation_engine.generate_recommendations_for_fleet(all_machines)
roi_summary = roi_intelligence_service.compute_roi_summary()

# Main Application Tabs
tab_fleet, tab_recs, tab_roi, tab_sources = st.tabs([
    "🏭 Fleet Health & Physics",
    "🎯 Senseye Recommendations",
    "💰 Financial ROI & Ledger",
    "🔌 Connected OT/IT Sources & Lineage"
])

# ==============================================================================
# TAB 1: FLEET HEALTH & PHYSICS
# ==============================================================================
with tab_fleet:
    st.subheader("📊 Monitored Fleet Operations")
    st.caption(f"Showing {len(all_machines)} assets. Provenance: [SIMULATED] | Horizon: 24h | ISO 10816-3 Certified")

    # Top KPI Metrics
    kpi1, kpi2, kpi3, kpi4 = st.columns(4)
    high_risks = [m for m in all_machines if m["risk_category"] == "HIGH"]
    med_risks = [m for m in all_machines if m["risk_category"] == "MEDIUM"]
    fleet_reliability = 100.0 - (len(high_risks) / max(1, len(all_machines)) * 100.0)

    kpi1.metric("Assets Monitored", len(all_machines))
    kpi2.metric("Critical Alerts (CARI)", len(high_risks), delta=f"{len(high_risks)} Imminent" if high_risks else "Nominal", delta_color="inverse")
    kpi3.metric("Medium Risk (Watchlist)", len(med_risks))
    kpi4.metric("Fleet Reliability Score", f"{fleet_reliability:.1f}%")

    if high_risks:
        st.error(f"🚨 **IMMINENT TRIP ALARM**: {len(high_risks)} machine(s) exceed ISO 10816 Zone D vibration trip limits!")

    st.markdown("### 📋 Asset Health Matrix")
    # Build display table
    table_rows = []
    for m in all_machines:
        dim = canonical_mapping_service.get_canonical_asset(m["machine_id"])
        hourly_loss = dim.hourly_downtime_cost_usd if dim else 2500.0
        crit = dim.criticality.value if dim else "B"
        table_rows.append({
            "Asset ID": m["machine_id"],
            "Asset Name": dim.asset_name if dim else m["machine_type"],
            "Plant": m["plant_id"],
            "Criticality": crit,
            "Operating Hours": m["operating_hours"],
            "Vibration (mm/s)": m["latest_vibration"],
            "Temperature (°C)": m["latest_temperature"],
            "Failure Prob (24h)": f"{m['failure_probability']:.1%}",
            "Risk Tier": m["risk_category"],
            "Downtime Impact ($/hr)": f"${hourly_loss:,.0f}",
            "Data Provenance": "SIMULATED",
        })

    df_table = pd.DataFrame(table_rows)
    st.dataframe(df_table, use_container_width=True, hide_index=True)

    # Drill-down Time Series Chart
    st.divider()
    st.subheader("📈 Machine Telemetry Drill-down & ISO 10816 Zones")
    selected_asset = st.selectbox("Select Asset to Inspect Time-Series", [m["machine_id"] for m in all_machines])

    history_readings = asyncio.run(machine_service.get_readings_history(selected_asset, limit=30))
    if history_readings:
        df_hist = pd.DataFrame(history_readings)
        df_hist["reading_index"] = range(len(df_hist))

        fig = go.Figure()
        # Actual/Simulated vibration line
        fig.add_trace(go.Scatter(
            x=df_hist["reading_index"],
            y=df_hist["vibration_mm_s"],
            mode="lines+markers",
            name="Vibration RMS (mm/s)",
            line=dict(color="#2563eb", width=3)
        ))

        # ISO Zones
        fig.add_hline(y=cfg.iso_thresholds.zone_a_good_max, line_dash="dash", line_color="#10b981", annotation_text="Zone A (Good)")
        fig.add_hline(y=cfg.iso_thresholds.zone_b_acceptable_max, line_dash="dash", line_color="#f59e0b", annotation_text="Zone B (Acceptable)")
        fig.add_hline(y=cfg.iso_thresholds.zone_c_unsatisfactory_max, line_dash="dash", line_color="#ef4444", annotation_text="Zone C / D (Trip Danger)")

        fig.update_layout(
            title=f"Telemetry Vibration Drift — {selected_asset} (ISO 10816 Zone Assessment)",
            xaxis_title="Historical Tick Index (5 min intervals)",
            yaxis_title="Vibration RMS (mm/s)",
            hovermode="x unified",
        )
        st.plotly_chart(fig, use_container_width=True)

# ==============================================================================
# TAB 2: SENSEYE RECOMMENDATIONS
# ==============================================================================
with tab_recs:
    st.subheader("🎯 Siemens Senseye-Style Actionable Maintenance Advisories")
    st.caption("Ranked by Criticality-Adjusted Risk Index (CARI). Human approval required for work order creation.")

    for rec in recommendations:
        cari_score = rec.supporting_evidence.get("cari_score", 0.0)
        p_fail = rec.supporting_evidence.get("failure_probability", 0.0)
        hourly_loss = rec.supporting_evidence.get("hourly_downtime_cost_usd", 2500.0)

        # Visual color based on urgency
        border_color = "#ef4444" if rec.urgency == RecommendationUrgency.IMMEDIATE else ("#f59e0b" if rec.urgency == RecommendationUrgency.SCHEDULED_NEXT_SHIFT else "#3b82f6")

        with st.container(border=True):
            r_col1, r_col2, r_col3 = st.columns([3, 1, 1])

            with r_col1:
                st.markdown(f"#### ⚙️ **{rec.asset_id}** — {rec.recommended_action}")
                st.write(f"**Rationale**: {rec.rationale}")
                st.caption(f"**Supporting Evidence**: Failure Prob = **{p_fail:.1%}** | Vibration = **{rec.supporting_evidence.get('vibration_rms', 0.0)} mm/s** | CARI Score = **{cari_score}** | Downtime Loss = **${hourly_loss:,.0f}/hr**")

                # Spare parts indicator
                if rec.parts_available:
                    st.success(f"✅ **ERP Spare Parts Available**: {', '.join(rec.required_parts)} in stock")
                else:
                    st.error(f"⚠️ **ERP PARTS STOCKOUT ALERT**: {rec.required_parts[0]} is out of stock! Expedited PO required before downtime window.")

            with r_col2:
                st.metric("Downtime Avoided", f"{rec.expected_downtime_avoided_hours:.1f} hrs")
                st.metric("Cost Avoidance", f"${rec.expected_cost_avoidance_usd:,.0f}", delta="Estimated Savings")

            with r_col3:
                st.write(f"**Status**: `{rec.approval_status.value}`")
                if rec.approval_status == ApprovalStatus.APPROVED:
                    st.info(f"Signed off by: {rec.approved_by}\nWork Order: `{rec.cmms_work_order_created}`")
                elif rec.approval_status == ApprovalStatus.REJECTED:
                    st.caption(f"Rejected by: {rec.approved_by}")
                else:
                    # Action buttons
                    if st.button("✅ Approve", key=f"app_{rec.recommendation_id}"):
                        recommendation_engine.approve_recommendation(rec.recommendation_id, "Chief Reliability Engineer")
                        st.rerun()
                    if st.button("❌ Reject", key=f"rej_{rec.recommendation_id}"):
                        recommendation_engine.reject_recommendation(rec.recommendation_id, "Shift Maintenance Lead")
                        st.rerun()

# ==============================================================================
# TAB 3: FINANCIAL ROI & LEDGER
# ==============================================================================
with tab_roi:
    st.subheader("💰 Platform Return on Investment (ROI) & Financial Ledger")
    st.caption("Rigorous financial accounting: Volume-adjusted unmonitored baseline vs realized & estimated savings.")

    # ROI Summary Cards
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Baseline Annual Downtime Loss", f"${roi_summary.baseline_annual_downtime_cost_usd:,.0f}", help="Historical unmonitored plant baseline (36 breakdowns/year @ $3,200/hr)")
    m2.metric("Realized Savings (Verified)", f"${roi_summary.realized_downtime_cost_avoided_usd:,.0f}", delta=f"{roi_summary.realized_downtime_hours_avoided:.1f} hrs avoided")
    m3.metric("Projected Total Net Benefit", f"${roi_summary.net_total_projected_benefit_usd:,.0f}", delta=f"{roi_summary.roi_percentage:.1f}% ROI")
    m4.metric("Platform Payback Period", f"{roi_summary.payback_period_months:.1f} Months", help="Time to recover platform implementation and operating expenditure")

    st.divider()

    # ROI Financial Waterfall Chart
    fig_roi = go.Figure(go.Waterfall(
        name="Financial ROI Impact",
        orientation="v",
        measure=["relative", "relative", "relative", "relative", "total"],
        x=["Baseline Annual Loss", "Realized Savings", "Projected Avoidance", "Platform & Maint Cost", "Net Enterprise Benefit"],
        textposition="outside",
        y=[
            -roi_summary.baseline_annual_downtime_cost_usd,
            roi_summary.realized_downtime_cost_avoided_usd,
            roi_summary.estimated_downtime_cost_avoided_usd,
            -(roi_summary.platform_annual_operating_cost_usd + roi_summary.preventive_maintenance_expenditure_usd),
            roi_summary.net_total_projected_benefit_usd,
        ],
        connector={"line": {"color": "rgb(63, 63, 63)"}},
    ))
    fig_roi.update_layout(title="Enterprise Financial Value Waterfall (USD)", yaxis_title="USD ($)")
    st.plotly_chart(fig_roi, use_container_width=True)

    # Auditable fact_roi_ledger Table
    st.markdown("### 📜 Auditable fact_roi_ledger Entries")
    st.caption("Immutable financial audit trail proving avoided downtime calculations and preventing double counting.")
    ledger_entries = roi_intelligence_service.get_ledger_entries()
    df_ledger = pd.DataFrame([{
        "Ledger ID": e.ledger_id,
        "Asset ID": e.asset_id,
        "Entry Type": e.entry_type.value,
        "Value Category": e.value_category.value,
        "Amount (USD)": f"${e.amount_usd:+,.2f}",
        "Hours": e.downtime_hours,
        "Calculation Formula": e.calculation_formula,
        "Evidence Reference": e.evidence_reference,
        "Cumulative Net ($)": f"${e.cumulative_net_benefit_usd:,.2f}",
    } for e in ledger_entries])
    st.dataframe(df_ledger, use_container_width=True, hide_index=True)

# ==============================================================================
# TAB 4: CONNECTED OT/IT SOURCES & LINEAGE
# ==============================================================================
with tab_sources:
    st.subheader("🔌 Connected OT/IT Source Systems & Lineage")
    st.caption("Unified enterprise connectivity: PLC/SCADA telemetry, CMMS maintenance history, MES downtime, and ERP inventory.")

    for s in sources:
        with st.container(border=True):
            sc1, sc2, sc3 = st.columns([2, 1, 1])
            with sc1:
                st.markdown(f"#### {s.system_name} (`{s.system_id}`)")
                st.write(f"**System Type**: `{s.system_type}` | **Active Endpoint/Path**: `{s.endpoint_or_path}`")
                st.write(f"**Status Detail**: {s.status_detail}")

                if s.missing_prerequisites:
                    st.markdown("**Missing Access Prerequisites:**")
                    for p in s.missing_prerequisites:
                        st.write(f"- ⚠️ `{p}`")
                else:
                    st.success("✅ All required access credentials verified.")

            with sc2:
                badge = "🟢 ACTUAL" if s.is_actual else "🟡 SIMULATED"
                st.markdown(f"**Data Provenance**: {badge}")
                st.metric("Records Ingested", s.records_ingested_count)

            with sc3:
                st.markdown(f"**Connection State**:\n`{s.state.value}`")
                st.caption(f"Last Sync: {s.last_sync_timestamp.strftime('%H:%M:%S UTC') if s.last_sync_timestamp else 'Never'}")

    st.divider()
    st.markdown("### 🌉 Cross-System Entity Bridge Registry (`bridge_asset_source_id`)")
    st.caption("Translates native shop-floor PLC tags and SAP/Maximo identifiers to canonical asset_id.")

    bridge_rows = []
    for asset in canonical_mapping_service.list_canonical_assets():
        bridge_rows.append({
            "Canonical asset_id": asset.asset_id,
            "Equipment Type": asset.equipment_type,
            "Plant": asset.plant_id,
            "Line": asset.line_id,
            "PLC / SCADA Tag": f"TAG_{asset.plant_id[:4]}_{asset.asset_id}",
            "CMMS Maximo ID": f"MX-EQ-{1000 + int(asset.asset_id.split('-')[1])}",
            "MES Opcenter Station": f"OPC-ST-{asset.asset_id}",
            "ERP SAP Asset #": f"SAP-AST-{8000 + int(asset.asset_id.split('-')[1])}",
            "Hourly Downtime Loss": f"${asset.hourly_downtime_cost_usd:,.0f}",
        })
    df_bridge = pd.DataFrame(bridge_rows)
    st.dataframe(df_bridge, use_container_width=True, hide_index=True)
