"""FastAPI application entrypoint for the Predictive Maintenance platform."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.api.routes import router

app = FastAPI(
    title="GCP Predictive Maintenance Platform",
    version="1.0.0",
    description="Enterprise Industrial Predictive Maintenance API powered by Google Cloud Platform, BigQuery, and Machine Learning",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
