"""Google Cloud Vertex AI integration wrapper for custom training and endpoint deployment."""
import logging
from typing import Optional

logger = logging.getLogger("ml.vertex_ai")


class VertexAIModelDeployer:
    """Manages Vertex AI Model Registry uploads and Cloud Run / Vertex Endpoint deployments."""

    def __init__(self, project_id: str, location: str = "asia-southeast1", staging_bucket: Optional[str] = None) -> None:
        self.project_id = project_id
        self.location = location
        self.staging_bucket = staging_bucket

    def upload_model(self, artifact_uri: str, model_display_name: str = "predictive-maintenance-rf"):
        """Registers the scikit-learn artifact into Google Cloud Vertex AI Model Registry."""
        try:
            from google.cloud import aiplatform
            aiplatform.init(project=self.project_id, location=self.location, staging_bucket=self.staging_bucket)
            
            logger.info(f"Uploading model to Vertex AI: {model_display_name} from {artifact_uri}")
            model = aiplatform.Model.upload(
                display_name=model_display_name,
                artifact_uri=artifact_uri,
                serving_container_image_uri="asia-docker.pkg.dev/vertex-ai/prediction/sklearn-cpu.1-5:latest",
            )
            return model
        except Exception as e:
            logger.warning(f"Vertex AI upload skipped (local development mode active or ADC missing): {e}")
            return None
