"""CSV parser backed by Python stdlib csv module."""

import csv
import io


def parse_csv(text, delimiter=","):
    if not isinstance(text, str) or not text.strip():
        raise ValueError("CSV input is empty")
    buf = io.StringIO(text)
    reader = csv.DictReader(buf, delimiter=delimiter)
    headers = list(reader.fieldnames or [])
    if not headers or all(not str(h).strip() for h in headers):
        raise ValueError("CSV input has no header row")
    rows = [dict(row) for row in reader]
    return {"headers": headers, "rows": rows}
