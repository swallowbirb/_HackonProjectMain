"""
Gemini Pass 2 — Grade Synthesizer (Task 2.8, Requirement 7)

Sends the Analysis_Summary TEXT ONLY (no raw images) plus base + category prompts to
Gemini, parses to a canonical Grade JSON, and enforces enums + numeric bounds. Sets
missingEvidence from insufficient-evidence signals and downgrades confidence.
"""
import json
import logging
from typing import Dict, Any, Optional

from app.config import settings
from app.services import prompt_loader
from app.services.gemini import gemini_service, GeminiError, GeminiJSONError
from app.services.rekognition import REKOGNITION_VERSION
from app.services.grade_validation import coerce_and_validate, GradeValidationError

logger = logging.getLogger("ml-service.grade_synth")


class GradeSynthesisError(Exception):
    """Pass-2 produced no valid Grade JSON after primary + fallback attempts."""


async def synthesize_grade(
    analysis_summary: Dict[str, Any],
    category: Optional[str] = None,
    pass1_model: Optional[str] = None,
    seller_prompt: Optional[str] = None,
    base_prompt: Optional[str] = None,
    category_prompt: Optional[str] = None,
    trace=None,
) -> Dict[str, Any]:
    """
    Run Pass 2. Returns a dict with the validated Grade JSON fields plus modelVersions
    and the composed prompt. Raises GradeSynthesisError on irrecoverable failure.
    """
    template = prompt_loader.load_template("pass2_grade_synthesis.txt")
    body = template.format(analysis_summary=json.dumps(analysis_summary, ensure_ascii=False, indent=2))
    prompt = prompt_loader.compose(category, body, seller_prompt=seller_prompt,
                                   base_override=base_prompt, category_override=category_prompt)

    if trace is not None:
        trace.info("pass2", "PASS2_PROMPT",
                   f"📝 Pass 2 prompt composed ({len(prompt)} chars, category={category or 'generic'}). "
                   "Sending the TEXT analysis summary only (no raw images) to Gemini.",
                   prompt_chars=len(prompt), category=category)

    try:
        raw = await gemini_service.invoke_json(prompt, images=None, max_tokens=2000,
                                                trace=trace, phase="pass2", label="Pass 2 grade synthesizer")
    except (GeminiError, GeminiJSONError) as exc:
        # The detailed per-attempt error was already traced inside gemini_service.
        if trace is not None:
            trace.error("pass2", "PASS2_FAILED",
                        f"❌ Pass 2 grade synthesis failed — {type(exc).__name__}: {exc}", exc=exc)
        raise GradeSynthesisError(f"Gemini Pass-2 failed: {exc}") from exc

    try:
        grade = coerce_and_validate(raw, analysis_summary)
    except GradeValidationError as exc:
        if trace is not None:
            trace.error("pass2", "PASS2_VALIDATION",
                        f"❌ Pass 2 returned JSON that failed grade validation: {exc}", exc=exc, raw=raw)
        raise GradeSynthesisError(str(exc)) from exc
    used_pass2_model = getattr(gemini_service, "_current_model", settings.gemini_model_primary)
    grade["modelVersions"] = {
        "pass1Model": pass1_model or settings.gemini_model_primary,
        "pass2Model": used_pass2_model,
        "rekognitionVersion": REKOGNITION_VERSION,
    }
    grade["_prompt"] = prompt

    if trace is not None:
        trace.success("pass2", "PASS2_GRADE",
                      f"🎯 Pass 2 synthesized Grade {grade.get('grade')} "
                      f"({grade.get('qualityScore')}/100, confidence={grade.get('confidence')}, "
                      f"routing={grade.get('routingHint')}) using {used_pass2_model}",
                      grade=grade.get("grade"), quality_score=grade.get("qualityScore"),
                      confidence=grade.get("confidence"), routing_hint=grade.get("routingHint"),
                      pass2_model=used_pass2_model)

    return grade
