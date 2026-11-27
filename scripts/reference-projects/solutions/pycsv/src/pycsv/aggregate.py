"""Group-by numeric aggregation over CSV rows."""


def aggregate(rows, group_by, metric_col):
    buckets = {}
    for row in rows or []:
        key = str(row.get(group_by, ""))
        raw = row.get(metric_col)
        if raw is None or str(raw).strip() == "":
            continue
        val = float(str(raw).strip())
        buckets.setdefault(key, []).append(val)
    result = []
    for group in sorted(buckets.keys()):
        vals = buckets[group]
        total = sum(vals)
        result.append({
            "group": group,
            "count": len(vals),
            "sum": round(total, 4),
            "min": round(min(vals), 4),
            "max": round(max(vals), 4),
            "avg": round(total / len(vals), 4),
        })
    return result
