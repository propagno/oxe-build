"""Schema validation for parsed CSV headers and rows."""


def _matches_type(value, expected):
    raw = "" if value is None else str(value).strip()
    if expected == "str":
        return True
    if expected == "int":
        try:
            int(raw)
            return True
        except ValueError:
            return False
    if expected == "float":
        try:
            float(raw)
            return True
        except ValueError:
            return False
    if expected == "bool":
        return raw.lower() in ("true", "false", "1", "0", "yes", "no")
    raise ValueError(f"Unsupported schema type: {expected}")


def validate_schema(headers, rows, schema):
    schema = schema or {}
    errors = []
    header_set = set(headers or [])
    for col in schema.get("required", []):
        if col not in header_set:
            errors.append({
                "row": 0,
                "column": col,
                "code": "missing_column",
                "message": f"Required column '{col}' is missing",
            })
    types = schema.get("types", {})
    for idx, row in enumerate(rows or [], start=1):
        for col, expected in types.items():
            if col not in row:
                continue
            val = row[col]
            if val is None or str(val).strip() == "":
                continue
            if not _matches_type(val, expected):
                errors.append({
                    "row": idx,
                    "column": col,
                    "code": "invalid_type",
                    "message": f"Row {idx} column '{col}' value '{val}' is not a valid {expected}",
                })
    return errors
