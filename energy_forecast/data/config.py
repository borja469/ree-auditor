from __future__ import annotations

from pathlib import Path

from .aliases import normalize_name


def load_simple_yaml_mapping(path: str | Path) -> dict[str, dict[str, object]]:
    text = Path(path).read_text(encoding="utf-8")
    result: dict[str, dict[str, object]] = {}
    current: str | None = None
    for raw_line in text.splitlines():
        if not raw_line.strip() or raw_line.strip().startswith("#"):
            continue
        if not raw_line.startswith((" ", "\t")) and raw_line.strip().endswith(":"):
            current = normalize_name(raw_line.strip()[:-1])
            result[current] = {}
            continue
        if current and ":" in raw_line:
            key, value = raw_line.strip().split(":", 1)
            result[current][normalize_name(key)] = parse_scalar(value.strip())
    return result


def parse_scalar(value: str) -> object:
    if value == "":
        return None
    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        return value.strip("\"'")
