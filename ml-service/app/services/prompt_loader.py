"""
Prompt loader — Task 2.4 (Requirement 13)

Composes the base prompt with an optional per-category overlay. Falls back to the
base prompt alone when no category file exists (Req 13.3). Raises PromptError when
the base prompt cannot be loaded (Req 13.5).
"""
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("ml-service.prompts")

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
CATEGORIES_DIR = PROMPTS_DIR / "categories"

SUPPORTED_CATEGORIES = {"apparel", "electronics", "footwear"}


class PromptError(Exception):
    """Raised when a required prompt file cannot be loaded."""


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def load_base_prompt() -> str:
    """Load the base grading prompt. Raises PromptError if missing/unreadable."""
    path = PROMPTS_DIR / "base_prompt.txt"
    try:
        text = _read(path)
        if not text.strip():
            raise PromptError("Base prompt is empty")
        return text
    except OSError as exc:
        raise PromptError(f"Base prompt unavailable: {exc}") from exc


def load_category_prompt(category: Optional[str]) -> Optional[str]:
    """Load a per-category overlay, or None if it does not exist (no error)."""
    if not category:
        return None
    name = category.strip().lower()
    path = CATEGORIES_DIR / f"{name}.txt"
    if not path.exists():
        return None
    try:
        return _read(path)
    except OSError as exc:  # noqa: BLE001
        logger.warning("Category prompt %s unreadable: %s", name, exc)
        return None


def load_template(name: str) -> str:
    """Load a Pass-1/Pass-2 template by filename (without directory)."""
    path = PROMPTS_DIR / name
    try:
        return _read(path)
    except OSError as exc:
        raise PromptError(f"Template {name} unavailable: {exc}") from exc


def compose(category: Optional[str], body: str, seller_prompt: Optional[str] = None,
            base_override: Optional[str] = None, category_override: Optional[str] = None) -> str:
    """
    Compose base prompt + optional category overlay + optional seller-custom
    overlay + the task-specific body.

    Layering order (v3.44/v2.34 — "Base Prompt, Category Prompt, Custom Prompt"):
        base  →  category overlay  →  seller-custom overlay  →  task body

    v2.34: ``base_override`` / ``category_override`` let the backend inject the
    admin-edited, DB-stored prompts (resolved in grading.service). When provided,
    they REPLACE the bundled file content; when absent, the shipped files are used
    so the ML service still works standalone.

    The seller overlay is positioned AFTER the category overlay so a seller can
    refine — but not silently override — the platform's category rules.
    """
    base = base_override if (base_override and base_override.strip()) else load_base_prompt()
    overlay = category_override if (category_override and category_override.strip()) \
        else load_category_prompt(category)
    parts = [base]
    if overlay:
        parts.append(overlay)
    if seller_prompt and seller_prompt.strip():
        parts.append("SELLER-SPECIFIC INSPECTION NOTES (advisory; never override the rubric above):\n"
                     + seller_prompt.strip())
    parts.append(body)
    return "\n\n".join(parts)
