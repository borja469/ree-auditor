from __future__ import annotations

import re
from pathlib import Path

DEFAULT_ALIAS_PATH = Path(__file__).resolve().parents[1] / "config" / "column_aliases.yaml"


def normalize_name(value: object) -> str:
    text = str(value).strip().lower()
    replacements = str.maketrans("áéíóúüñ", "aeiouun")
    text = text.translate(replacements)
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_")


def load_aliases(path: str | Path | None = None) -> dict[str, list[str]]:
    alias_path = Path(path) if path else DEFAULT_ALIAS_PATH
    if not alias_path.exists():
        return {}
    text = alias_path.read_text(encoding="utf-8")
    try:
        import yaml

        payload = yaml.safe_load(text) or {}
        return {normalize_name(key): [normalize_name(item) for item in values] for key, values in payload.items()}
    except Exception:
        return parse_simple_yaml_aliases(text)


def parse_simple_yaml_aliases(text: str) -> dict[str, list[str]]:
    aliases: dict[str, list[str]] = {}
    current: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if not raw_line.startswith((" ", "\t")) and line.endswith(":"):
            current = normalize_name(line[:-1])
            aliases[current] = []
            continue
        if current and line.startswith("- "):
            aliases[current].append(normalize_name(line[2:]))
    return aliases


def build_alias_lookup(aliases: dict[str, list[str]]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for canonical, values in aliases.items():
        lookup[normalize_name(canonical)] = canonical
        for alias in values:
            lookup[normalize_name(alias)] = canonical
    return lookup


def recognize_columns(columns: list[object], aliases: dict[str, list[str]]) -> dict[str, str]:
    lookup = build_alias_lookup(aliases)
    recognized: dict[str, str] = {}
    for column in columns:
        normalized = normalize_name(column)
        if normalized in lookup:
            recognized[str(column)] = lookup[normalized]
            continue
        for alias, canonical in lookup.items():
            if alias and (alias in normalized or normalized in alias):
                recognized[str(column)] = canonical
                break
    return recognized
