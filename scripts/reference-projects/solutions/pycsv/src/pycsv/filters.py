"""Row filtering by comparison and substring expressions."""

import re

_EXPR_RE = re.compile(r"^\s*([A-Za-z0-9_.-]+)\s*(==|!=|>=|<=|>|<|~)\s*(.+?)\s*$")


def filter_rows(rows, expr):
    match = _EXPR_RE.match(str(expr or ""))
    if not match:
        raise ValueError(f"Invalid filter expression: {expr!r}")
    col, op, raw_val = match.group(1), match.group(2), match.group(3)
    out = []
    for row in rows or []:
        cell = "" if row.get(col) is None else str(row.get(col))
        if op == "==":
            if cell == raw_val:
                out.append(row)
        elif op == "!=":
            if cell != raw_val:
                out.append(row)
        elif op == "~":
            if raw_val.lower() in cell.lower():
                out.append(row)
        else:
            try:
                lhs = float(cell)
                rhs = float(raw_val)
            except ValueError:
                continue
            if (
                (op == ">" and lhs > rhs)
                or (op == ">=" and lhs >= rhs)
                or (op == "<" and lhs < rhs)
                or (op == "<=" and lhs <= rhs)
            ):
                out.append(row)
    return out
