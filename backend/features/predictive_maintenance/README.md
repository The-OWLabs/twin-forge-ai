# Predictive Maintenance Domain (`backend/features/predictive_maintenance`)

## 1. Domain Overview & Purpose
The **Predictive Maintenance** module monitors asset health, detects early mechanical/electrical degradation, and estimates the **Remaining Useful Life (RUL)** of rotating machinery, robotics, pumps, and pneumatic actuators. It shifts operations from reactive firefighting to precision condition-based maintenance.

---

## 2. Domain Models & Mathematical Foundations

### Core Entities & Value Objects (`domain/`)
- `AssetHealthScore`: Normalized score (0.0–1.0) aggregating vibration, temperature, acoustic emissions, and lubrication age.
- `VibrationSpectrum`: Fast Fourier Transform (FFT) frequency bands (1X, 2X, harmonics, high-frequency bearing defect frequencies: BPFI, BPFO, BSF, FTF).
- `ISO10816Severity`: Evaluation of machine vibration severity based on ISO 10816-3 (Zones A: Good, B: Acceptable, C: Unsatisfactory, D: Unacceptable).
- `DegradationCurve`: Exponential or Weibull hazard rate modeling cumulative fatigue damage.

### RUL Calculation Formula
$$RUL(t) = \frac{Threshold_{trip} - Measured(t)}{\alpha \cdot \text{Slope}_{OLS} + (1-\alpha) \cdot \text{Slope}_{change\_point}}$$

---

## 3. Ports & Contracts (`ports/`)

### Driving Ports (`ports/input/`)
- `IPredictiveMaintenanceUseCase`:
  - `diagnose_asset(asset_id: str) -> AssetDiagnosticReport`
  - `estimate_rul(asset_id: str) -> RulEstimate`
  - `evaluate_iso_severity(vibration_rms: float, asset_class: AssetClass) -> ISO10816Severity`

### Driven Ports (`ports/output/`)
- `ITelemetryHistoryReader`: Fetches sliding-window vibration and thermal time-series.
- `IWorkOrderEmitter`: Emits preventive work orders to the maintenance system.
- `IMaintenanceLogRepository`: Reads past maintenance interventions and replacement intervals.

---

## 4. MCP Tools & Agent Interfaces
- `diagnose_bearing_health(asset_id)`: Analyzes high-frequency FFT peaks and returns health zone.
- `compute_asset_rul(asset_id)`: Calculates hours until trip threshold breach.
- `propose_preventive_overhaul(asset_id, reason)`: Generates a human-in-the-loop pending work order.
