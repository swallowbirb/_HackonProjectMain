# ML Service

FastAPI microservice for AI/ML workloads — grading, vision, return prediction.

## Setup

```bash
cd ml-service
pip install -r requirements.txt
cp .env.example .env   # then fill in your GEMINI_API_KEY + AWS keys
uvicorn app.main:app --reload --port 8000
```

## Endpoints

| Method | Path | Status | Phase |
|--------|------|--------|-------|
| GET | /health | ✅ Ready | 0 |
| POST | /grade/ | ✅ Ready | 2 |
| POST | /grade/form | ✅ Ready | 2 |
| POST | /vision/validate-photo | ✅ Ready | 2 |
| POST | /vision/analyze-image | ✅ Ready | 2 |
| POST | /predict/return | 🔲 TODO | 7 |
| POST | /predict/fit-recommend | 🔲 TODO | 7 |

## Phase 2 — Grading pipeline

`POST /grade/` runs the full hybrid pipeline:

1. **Fraud preflight** (`services/fraud_preflight.py`) — imagehash vs catalog, EXIF
   camera metadata, Rekognition web/label signal. A hard signal short-circuits both
   Gemini passes.
2. **Parallel analysis** (`services/analysis_orchestrator.py`) — OpenCV color/histogram,
   CLIP visual similarity, Rekognition labels, Textract OCR via `asyncio.gather`. A
   single tool failure becomes a warning, not a crash.
3. **Pass 2 synthesis** (`services/grade_synthesizer.py`) — text-only Analysis_Summary +
   base/category prompts to Gemini, coerced into a canonical Grade JSON.

`POST /grade/form` runs **Pass 1** (`services/form_generator.py`) — generates a tailored
evidence Form_Schema, cached by `hash(productId + normalized_reason)` with TTL.

Prompts live in `app/prompts/` (base + per-category overlays + Pass 1/2 templates),
composed by `services/prompt_loader.py`.

## Tests

Dependency-free property + integration tests (no AWS/torch needed):

```bash
python tests/test_grading_properties.py
python tests/test_persona_integration.py
# or, with pytest installed:
python -m pytest tests
```

## Structure

```
app/
├── main.py           ← FastAPI app, CORS, router registration
├── config.py         ← Pydantic settings from .env
├── routers/          ← One file per domain
├── services/         ← Gemini LLM + AWS clients (Rekognition, Textract, CLIP)
└── models/           ← Pydantic request/response schemas
trained_models/       ← .joblib files for XGBoost (Phase 7)
```
