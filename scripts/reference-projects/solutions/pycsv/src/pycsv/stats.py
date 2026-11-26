"""Numeric column summary statistics."""


def column_stats(rows, col):
    values = []
    missing = 0
    for row in rows or []:
        raw = row.get(col)
        if raw is None or str(raw).strip() == "":
            missing += 1
            continue
        values.append(float(str(raw).strip()))
    if not values:
        return {"column": col, "count": 0, "missing": missing, "min": None, "max": None, "mean": None}
    return {
        "column": col,
        "count": len(values),
        "missing": missing,
        "min": round(min(values), 4),
        "max": round(max(values), 4),
        "mean": round(sum(values) / len(values), 4),
    }
