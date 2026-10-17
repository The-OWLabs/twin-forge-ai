import sys
from pathlib import Path
_repo_root = str(Path(__file__).resolve().parent.parent)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

"""Interactive Streamlit dashboard for GCP Predictive Maintenance Platform."""
import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime
import asyncio
from backend.features.predictive_maintenance.repositories.local_mock_repo import LocalMockMachineRepository
from backend.features.predictive_maintenance.services.machine_service import MachineService

st.set_page_config(
    page_title="TwinForge - GCP Predictive Maintenance",
    page_icon="⚙️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Initialize service
@st.cache_resource
def get_service():
    repo = LocalMockMachineRepository(num_machines=20)
    return MachineService(repo)

service = get_service()

# Header & Synthetic Notice
st.title("⚙️ GCP-Powered Predictive Maintenance Platform")
st.caption("Real-Time Industrial IoT Telemetry, Feature Engineering & Failure Forecasting")
st.info("ℹ️ **Simulated Mode**: Sensor data, vibration physics, and wear profiles are generated synthetically for development.")

# Sidebar Filters
st.sidebar.header("Fleet Filters")
selected_plant = st.sidebar.selectbox("Plant Location", ["All", "PLANT_BANGALORE", "PLANT_STUTTGART", "PLANT_DETROIT"])
selected_risk = st.sidebar.selectbox("Risk Level", ["All", "HIGH", "MEDIUM", "LOW"])

# Load Fleet Data
plant_filter = None if selected_plant == "All" else selected_plant
risk_filter = None if selected_risk == "All" else selected_risk

machines = asyncio.run(service.list_machines(plant_id=plant_filter, risk_category=risk_filter))
summary = asyncio.run(service.get_fleet_analytics())

# KPI Row
kpi1, kpi2, kpi3, kpi4 = st.columns(4)
kpi1.metric("Monitored Assets", summary["total_machines_monitored"])
kpi2.metric("High Risk Alerts", summary["high_risk_count"], delta=f"{summary['high_risk_count']} critical", delta_color="inverse")
kpi3.metric("Medium Risk (Watchlist)", summary["medium_risk_count"])
kpi4.metric("Fleet Reliability", f"{summary['healthy_fleet_percentage']}%")

st.divider()

# High-Risk Alert Banner
high_risk_machines = [m for m in machines if m["risk_category"] == "HIGH"]
if high_risk_machines:
    st.error(f"🚨 **CRITICAL ALERT**: {len(high_risk_machines)} machine(s) exhibit imminent failure risk within 24 hours!")
    for h in high_risk_machines:
        st.write(f"- **{h['machine_id']}** ({h['machine_type']}) at {h['plant_id']}: Failure Probability = **{h['failure_probability']:.1%}** | Vibration = **{h['latest_vibration']} mm/s**")

# Fleet Overview Table
st.subheader("📋 Fleet Status & Health Scores")
df_fleet = pd.DataFrame(machines)
if not df_fleet.empty:
    display_cols = ["machine_id", "machine_type", "plant_id", "risk_category", "failure_probability", "latest_vibration", "latest_temperature", "operating_hours"]
    st.dataframe(
        df_fleet[display_cols].style.highlight_max(subset=["failure_probability"], color="#ffcdd2"),
        use_container_width=True,
    )
else:
    st.warning("No machines match the selected filter criteria.")

st.divider()

# Machine Drill-Down & Time-Series Section
st.subheader("🔍 Machine Telemetry & Degradation Deep-Dive")
machine_ids = [m["machine_id"] for m in machines]
if machine_ids:
    selected_machine_id = st.selectbox("Select Asset for Diagnostic Telemetry", machine_ids)
    readings = asyncio.run(service.get_readings_history(selected_machine_id, limit=60))
    pred = asyncio.run(service.get_predictions(selected_machine_id))

    if readings:
        df_readings = pd.DataFrame(readings)
        df_readings["timestamp"] = pd.to_datetime(df_readings["timestamp"])

        col_left, col_right = st.columns([2, 1])

        with col_left:
            # Time-Series Charts (Vibration & Temperature)
            fig_vib = px.line(
                df_readings, x="timestamp", y="vibration_mm_s",
                title=f"Vibration Velocity RMS (mm/s) - {selected_machine_id}",
                color_discrete_sequence=["#e53935"],
            )
            fig_vib.add_hline(y=4.5, line_dash="dash", line_color="orange", annotation_text="ISO Zone C")
            fig_vib.add_hline(y=7.1, line_dash="dash", line_color="red", annotation_text="Trip Threshold")
            st.plotly_chart(fig_vib, use_container_width=True)

            fig_temp = px.line(
                df_readings, x="timestamp", y="temperature_celsius",
                title=f"Casing Temperature (°C) - {selected_machine_id}",
                color_discrete_sequence=["#1e88e5"],
            )
            st.plotly_chart(fig_temp, use_container_width=True)

        with col_right:
            st.markdown(f"### Diagnostics: {selected_machine_id}")
            prob = pred.get("failure_probability", 0.05) if pred else 0.05
            
            # Gauge Chart
            fig_gauge = go.Figure(go.Indicator(
                mode="gauge+number",
                value=prob * 100.0,
                domain={'x': [0, 1], 'y': [0, 1]},
                title={'text': "24h Failure Risk (%)"},
                gauge={
                    'axis': {'range': [None, 100]},
                    'bar': {'color': "darkred" if prob >= 0.70 else ("orange" if prob >= 0.35 else "green")},
                    'steps': [
                        {'range': [0, 35], 'color': "#e8f5e9"},
                        {'range': [35, 70], 'color': "#fff3e0"},
                        {'range': [70, 100], 'color': "#ffebee"},
                    ],
                }
            ))
            fig_gauge.update_layout(height=260, margin=dict(l=20, r=20, t=30, b=20))
            st.plotly_chart(fig_gauge, use_container_width=True)

            if pred:
                st.markdown(f"**Risk Category:** `{pred['risk_category']}`")
                st.markdown(f"**Recommended Action:** {pred['recommended_action']}")
                st.markdown(f"**Model Version:** `{pred['model_version']}`")
                st.caption(f"Contributing Factors: {pred.get('contributing_features', {})}")
