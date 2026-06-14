from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health, grading, vision, prediction

app = FastAPI(
    title="SecondLife ML Service",
    description="AI/ML microservice for product grading, vision analysis, and return prediction",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:5001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(grading.router, prefix="/grade", tags=["grading"])
app.include_router(vision.router, prefix="/vision", tags=["vision"])
app.include_router(prediction.router, prefix="/predict", tags=["prediction"])

