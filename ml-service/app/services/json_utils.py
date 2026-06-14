"""Pure JSON-extraction helper (no AWS deps) — shared by the Gemini client."""
import json
import re


class JSONExtractionError(Exception):
    """Raised when no valid JSON object can be parsed from model text."""


def extract_json(text: str) -> dict:
    """
    Strip any prose around a JSON object and parse the first valid one.
    Handles ```json fenced blocks and leading/trailing commentary.
    Raises JSONExtractionError when no valid JSON object can be parsed.
    """
    if not text or not text.strip():
        raise JSONExtractionError("Empty model response")

    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else None

    if candidate is None:
        start = text.find("{")
        if start == -1:
            raise JSONExtractionError("No JSON object found in model response")
        depth = 0
        for i in range(start, len(text)):
            ch = text[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start:i + 1]
                    break
        if candidate is None:
            raise JSONExtractionError("Unbalanced JSON object in model response")

    try:
        return json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise JSONExtractionError(f"Failed to parse JSON: {exc}") from exc
