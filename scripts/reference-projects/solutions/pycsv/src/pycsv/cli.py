"""CLI entrypoint for pycsv with exit codes 0 (ok), 1 (validation fail), 2 (usage/IO error)."""

import argparse
import sys

from .parser import parse_csv
from .schema import validate_schema
from .filters import filter_rows
from .aggregate import aggregate
from .stats import column_stats
from .formatters import format_json, format_csv


def _build_parser():
    parser = argparse.ArgumentParser(prog="pycsv", add_help=True)
    sub = parser.add_subparsers(dest="cmd")

    p_val = sub.add_parser("validate")
    p_val.add_argument("file")
    p_val.add_argument("--required", default="")
    p_val.add_argument("--format", choices=("json", "csv"), default="json")

    p_flt = sub.add_parser("filter")
    p_flt.add_argument("file")
    p_flt.add_argument("--where", required=True)
    p_flt.add_argument("--format", choices=("json", "csv"), default="json")

    p_agg = sub.add_parser("aggregate")
    p_agg.add_argument("file")
    p_agg.add_argument("--group-by", required=True)
    p_agg.add_argument("--metric", required=True)
    p_agg.add_argument("--format", choices=("json", "csv"), default="json")

    p_st = sub.add_parser("stats")
    p_st.add_argument("file")
    p_st.add_argument("--col", required=True)
    p_st.add_argument("--format", choices=("json", "csv"), default="json")
    return parser


def run_cli(argv, stdout=None, stderr=None):
    out = stdout if stdout is not None else sys.stdout
    err = stderr if stderr is not None else sys.stderr
    parser = _build_parser()
    try:
        args = parser.parse_args(list(argv))
    except SystemExit as exc:
        return 0 if exc.code == 0 else 2
    if not args.cmd:
        err.write("Missing subcommand (validate | filter | aggregate | stats)\n")
        return 2
    try:
        with open(args.file, "r", encoding="utf-8") as fh:
            text = fh.read()
        parsed = parse_csv(text)
    except (OSError, ValueError) as exc:
        err.write(f"Error: {exc}\n")
        return 2

    if args.cmd == "validate":
        req = [c.strip() for c in args.required.split(",") if c.strip()]
        errors = validate_schema(parsed["headers"], parsed["rows"], {"required": req})
        if args.format == "csv":
            out.write(format_csv(["row", "column", "code", "message"], errors))
        else:
            out.write(format_json(errors) + "\n")
        return 1 if errors else 0

    if args.cmd == "filter":
        try:
            rows = filter_rows(parsed["rows"], args.where)
        except ValueError as exc:
            err.write(f"Error: {exc}\n")
            return 2
        if args.format == "csv":
            out.write(format_csv(parsed["headers"], rows))
        else:
            out.write(format_json(rows) + "\n")
        return 0

    if args.cmd == "aggregate":
        groups = aggregate(parsed["rows"], args.group_by, args.metric)
        if args.format == "csv":
            out.write(format_csv(["group", "count", "sum", "min", "max", "avg"], groups))
        else:
            out.write(format_json(groups) + "\n")
        return 0

    if args.cmd == "stats":
        summary = column_stats(parsed["rows"], args.col)
        if args.format == "csv":
            out.write(format_csv(["column", "count", "missing", "min", "max", "mean"], [summary]))
        else:
            out.write(format_json(summary) + "\n")
        return 0

    return 2
