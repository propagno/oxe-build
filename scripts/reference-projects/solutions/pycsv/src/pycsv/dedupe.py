"""Deterministic row deduplication preserving first occurrence."""


def dedupe_rows(rows, key_cols):
    cols = list(key_cols or [])
    if not cols:
        return {"rows": list(rows or []), "duplicates": 0}
    seen = set()
    unique = []
    duplicates = 0
    for row in rows or []:
        key = tuple(row.get(c, "") for c in cols)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        unique.append(row)
    return {"rows": unique, "duplicates": duplicates}
