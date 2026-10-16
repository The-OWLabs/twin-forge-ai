# Visual Quality Inspection Domain (`backend/features/visual_quality_inspection`)

## 1. Domain Overview & Purpose
The **Visual Quality Inspection** module provides real-time Automated Optical Inspection (AOI) for manufacturing lines. It compares manufactured components against validated **Golden Templates**, identifies surface defects, checks solder integrity (IPC-A-610 standards), verifies barcode/QR compliance (ISO/IEC 15416), and flags anomalies before parts move downstream.

---

## 2. Domain Models & Processing Pipelines

### Core Entities & Value Objects (`domain/`)
- `InspectionFrame`: High-resolution RGB or radiometric thermal camera snapshot with metadata.
- `GoldenTemplate`: Verified reference image with registered keypoints, regions-of-interest (ROIs), and tolerance thresholds.
- `Defect`: Detected anomaly with bounding box/mask, confidence score, defect class, and severity.
- `InspectionResult`: Overall verdict (`PASS`, `FAIL`, `REVIEW_REQUIRED`) with Rolled Throughput Yield (RTY) contribution.

### Detection Pipeline
1. **Preprocessing**: Grayscale conversion, adaptive histogram equalization (CLAHE), Gaussian filtering.
2. **Alignment**: ORB/SIFT feature detection followed by RANSAC homography estimation to align the live frame with the golden template.
3. **Difference & Segmentation**: Absolute difference masking, contour detection, or deep neural segmentation (YOLO/U-Net).
4. **Classification & Grading**: Defects classified into standard classes (e.g., *solder bridge*, *tombstoning*, *surface pit*, *misalignment*).

---

## 3. Ports & Contracts (`ports/`)

### Driving Ports (`ports/input/`)
- `IVisualInspectionUseCase`:
  - `inspect_frame(camera_id: str, frame_bytes: bytes) -> InspectionResult`
  - `register_golden_template(part_number: str, image_bytes: bytes) -> TemplateRegistration`
  - `get_defect_pareto(line_id: str, time_range: TimeRange) -> DefectParetoReport`

### Driven Ports (`ports/output/`)
- `ICameraStreamAdapter`: Ingests video frames from RTSP, HLS, or industrial GigE Vision cameras.
- `IDefectModelInference`: Runs computer vision models (OpenCV, ONNX Runtime, TensorRT).
- `IInspectionResultRepository`: Persists inspection records and defect heatmaps.

---

## 4. MCP Tools & Agent Interfaces
- `inspect_camera_feed(camera_id)`: Triggers real-time frame capture and defect analysis.
- `get_quality_kpis(line_id)`: Returns First-Pass Yield (FPY), DPMO, and scrap rates.
- `verify_barcode_grade(image_bytes)`: Evaluates barcode readability under ISO/IEC 15416.
