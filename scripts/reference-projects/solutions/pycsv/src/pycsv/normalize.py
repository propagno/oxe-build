"""Non-mutating CSV row normalization."""


def normalize_rows(rows, trim=True, drop_empty=True, lowercase_cols=()):
    lower_set = set(lowercase_cols or ())
    out = []
    for row in rows or []:
        cleaned = {}
        for k, v in row.items():
            val = "" if v is None else str(v)
            if trim:
                val = val.strip()
            if k in lower_set:
                val = val.lower()
            cleaned[k] = val
        if drop_empty and all(v == "" for v in cleaned.values()):
            continue
        out.append(cleaned)
    return out
