"""The generated types and resource tables are importable, resolvable and consistent."""
import re
import typing
from pathlib import Path

import checkbox
from checkbox import types

ROOT = Path(__file__).resolve().parents[1]


def test_all_typed_dicts_resolve():
    count = 0
    for name in dir(types):
        obj = getattr(types, name)
        if isinstance(obj, type) and issubclass(obj, dict) and hasattr(obj, "__annotations__") and obj.__module__ == types.__name__:
            typing.get_type_hints(obj)  # raises on a dangling forward reference
            count += 1
    assert count > 100
    hints = typing.get_type_hints(types.Site)
    assert "id" in hints and "compliance" in hints


def test_webhook_event_types_and_error_codes():
    assert "finding.created" in types.WEBHOOK_EVENT_TYPES
    assert types.ERROR_CODES["resource_missing"]["status"] == 404
    assert checkbox.API_VERSION == types.API_VERSION


def test_versions_match_pyproject():
    py = (ROOT / "pyproject.toml").read_text()
    assert re.search(rf'^version = "{re.escape(checkbox.VERSION)}"$', py, re.M)
