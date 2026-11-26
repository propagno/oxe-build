"""Composable end-to-end CSV processing pipeline."""

from .parser import parse_csv
from .normalize import normalize_rows
from .filters import filter_rows
from .dedupe import dedupe_rows
from .aggregate import aggregate
from .stats import column_stats


def run_pipeline(text, options=None):
    opts = options or {}
    parsed = parse_csv(text, delimiter=opts.get("delimiter", ","))
    rows = normalize_rows(
        parsed["rows"],
        trim=opts.get("trim", True),
        drop_empty=opts.get("drop_empty", True),
        lowercase_cols=opts.get("lowercase_cols", ()),
    )
    duplicates = 0
    if opts.get("dedupe_keys"):
        deduped = dedupe_rows(rows, opts["dedupe_keys"])
        rows = deduped["rows"]
        duplicates = deduped["duplicates"]
    if opts.get("filter_expr"):
        rows = filter_rows(rows, opts["filter_expr"])
    out = {
        "headers": parsed["headers"],
        "rows": rows,
        "duplicates": duplicates,
    }
    if opts.get("group_by") and opts.get("metric_col"):
        out["groups"] = aggregate(rows, opts["group_by"], opts["metric_col"])
    if opts.get("stats_col"):
        out["stats"] = column_stats(rows, opts["stats_col"])
    return out
