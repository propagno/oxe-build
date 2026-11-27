"""JSON and LF-normalized CSV output formatters."""

import csv
import io
import json


def format_json(data):
    return json.dumps(data, indent=2, ensure_ascii=False)


def format_csv(headers, rows):
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(headers)
    for row in rows or []:
        writer.writerow([row.get(h, "") for h in headers])
    return buf.getvalue()
