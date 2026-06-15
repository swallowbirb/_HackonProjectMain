"""Pure JSON-extraction helper (no AWS deps) — shared by the Gemini client."""
import json
import logging
import re

logger = logging.getLogger("ml-service.json_utils")


class JSONExtractionError(Exception):
    """Raised when no valid JSON object can be parsed from model text."""


def _recover_truncated_json(text: str) -> str | None:
    """
    Attempt to close a truncated JSON string by appending missing closing chars.

    Walks the string tracking a brace/bracket stack (respecting string escapes).
    When the stack is non-empty at EOF, trims a trailing comma (common LLM cut-point)
    and appends the matching closers in reverse order.

    Returns the patched candidate string, or None when the text has no open
    structures left (i.e. it was already balanced when scanned this way).
    """
    stack = []
    in_string = False
    escape_next = False

    for ch in text:
        if escape_next:
            escape_next = False
            continue
        if in_string:
            if ch == '\\':
                escape_next = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in ('{', '['):
            stack.append('}' if ch == '{' else ']')
        elif ch in ('}', ']'):
            if stack and stack[-1] == ch:
                stack.pop()

    if not stack:
        return None  # already balanced

    # Strip trailing whitespace + a dangling comma before injecting closers.
    patched = text.rstrip()
    if patched.endswith(','):
        patched = patched[:-1].rstrip()
    return patched + ''.join(reversed(stack))


def extract_json(text: str) -> dict:
    """
    Strip any prose around a JSON object and parse the first valid one.
    Handles ```json fenced blocks and leading/trailing commentary.

    When the JSON object is unbalanced (e.g. truncated by a token limit),
    attempts to close the open structures and parse the recovered candidate
    before raising JSONExtractionError.

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
        in_string = False
        escape_next = False
        for i in range(start, len(text)):
            ch = text[i]
            if escape_next:
                escape_next = False
                continue
            if in_string:
                if ch == '\\':
                    escape_next = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    candidate = text[start:i + 1]
                    break

        if candidate is None:
            # Unbalanced — the response was truncated. Try to close open structures.
            truncated = text[start:]
            recovered = _recover_truncated_json(truncated)
            if recovered:
                try:
                    result = json.loads(recovered)
                    logger.warning(
                        "JSON response was truncated (unbalanced braces). "
                        "Recovery succeeded — parsed %d top-level key(s). "
                        "Consider raising max_tokens if this happens repeatedly.",
                        len(result) if isinstance(result, dict) else 0,
                    )
                    return result
                except json.JSONDecodeError as recovery_exc:
                    logger.warning(
                        "JSON truncation recovery attempted but re-parse failed: %s. "
                        "Original text was %d chars.",
                        recovery_exc, len(text),
                    )
            raise JSONExtractionError("Unbalanced JSON object in model response")

    try:
        return json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise JSONExtractionError(f"Failed to parse JSON: {exc}") from exc
