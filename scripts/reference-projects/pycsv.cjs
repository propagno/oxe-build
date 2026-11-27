'use strict';

/**
 * Reference project 3 (1.22.1 / OXB-221-11): `pycsv`, a CSV validation, filtering,
 * aggregation and statistics CLI in pure Python 3 stdlib (zero pip dependencies).
 * Two program phases, ten frozen tasks, independent Python unittest oracles.
 */

const F1 = {
  id: 'F1',
  title: 'Parser, validação e transformação CSV',
  scope: 'parser CSV com aspas e CRLF, validador de schema, filtros de expressão, normalização e deduplicação',
  tasks: [
    {
      id: 'T1', wave: 1, title: 'Parser CSV stdlib', files: ['src/pycsv/parser.py'], aceite: 'A1',
      criterion: 'parse_csv lê cabeçalhos e linhas com aspas, vírgulas internas e quebras LF/CRLF, rejeitando entrada vazia',
      goal: 'parse_csv(text, delimiter=",") devolve {"headers": [...], "rows": [dict, ...]} usando csv.DictReader. Lança ValueError se text for vazio ou não tiver cabeçalho.',
      symbols: [['src/pycsv/parser.py', 'parse_csv']],
      commit: 'feat(parser): csv parser with headers and validation',
    },
    {
      id: 'T2', wave: 2, dependsOn: ['T1'], title: 'Validação de schema', files: ['src/pycsv/schema.py'], aceite: 'A2',
      criterion: 'validate_schema verifica colunas obrigatórias e tipos int, float, bool e str devolvendo erros por linha e coluna',
      goal: 'validate_schema(headers, rows, schema) verifica schema.get("required", []) e schema.get("types", {}) devolvendo lista de dicts {"row": int, "column": str, "code": str, "message": str}.',
      symbols: [['src/pycsv/schema.py', 'validate_schema']],
      commit: 'feat(schema): required columns and scalar type validator',
    },
    {
      id: 'T3', wave: 2, dependsOn: ['T1'], title: 'Filtro de linhas por expressão', files: ['src/pycsv/filters.py'], aceite: 'A3',
      criterion: 'filter_rows filtra linhas suportando ==, !=, >=, <=, >, < e ~ (substring case-insensitive)',
      goal: 'filter_rows(rows, expr) avalia expressões col<op>val e devolve lista filtrada; lança ValueError em expressão inválida.',
      symbols: [['src/pycsv/filters.py', 'filter_rows']],
      commit: 'feat(filters): comparison and substring row filters',
    },
    {
      id: 'T4', wave: 2, dependsOn: ['T1'], title: 'Normalização de células e linhas vazias', files: ['src/pycsv/normalize.py'], aceite: 'A4',
      criterion: 'normalize_rows faz trim de espaços, descarta linhas totalmente vazias e aplica lowercase nas colunas informadas',
      goal: 'normalize_rows(rows, trim=True, drop_empty=True, lowercase_cols=()) devolve nova lista de dicts normalizados sem mutar os originais.',
      symbols: [['src/pycsv/normalize.py', 'normalize_rows']],
      commit: 'feat(normalize): cell trimming and empty row cleanup',
    },
    {
      id: 'T5', wave: 2, dependsOn: ['T1'], title: 'Deduplicação por chaves', files: ['src/pycsv/dedupe.py'], aceite: 'A5',
      criterion: 'dedupe_rows mantém a primeira ocorrência de cada tupla de key_cols e contabiliza duplicatas removidas',
      goal: 'dedupe_rows(rows, key_cols) devolve {"rows": [...], "duplicates": int}.',
      symbols: [['src/pycsv/dedupe.py', 'dedupe_rows']],
      commit: 'feat(dedupe): deterministic deduplication by key columns',
    },
  ],
  acceptance: {
    A1: `import unittest
from pycsv.parser import parse_csv


class TestA1Parser(unittest.TestCase):
    def test_parse_csv_basic_and_quotes(self):
        text = 'name,city,amount\\r\\n"Ana, Silva",Recife,10.5\\r\\nBruno,Salvador,20\\r\\n'
        parsed = parse_csv(text)
        self.assertEqual(parsed["headers"], ["name", "city", "amount"])
        self.assertEqual(len(parsed["rows"]), 2)
        self.assertEqual(parsed["rows"][0]["name"], "Ana, Silva")
        self.assertEqual(parsed["rows"][1]["amount"], "20")

    def test_parse_csv_empty_raises(self):
        with self.assertRaises(ValueError):
            parse_csv("   \\n")


if __name__ == "__main__":
    unittest.main()
`,
    A2: `import unittest
from pycsv.parser import parse_csv
from pycsv.schema import validate_schema


class TestA2Schema(unittest.TestCase):
    def test_validate_schema_required_and_types(self):
        parsed = parse_csv("id,score,active\\n1,9.5,true\\nabc,bad,maybe\\n")
        errs = validate_schema(
            parsed["headers"],
            parsed["rows"],
            {"required": ["id", "email"], "types": {"id": "int", "score": "float", "active": "bool"}},
        )
        codes = {(e["row"], e["column"], e["code"]) for e in errs}
        self.assertIn((0, "email", "missing_column"), codes)
        self.assertIn((2, "id", "invalid_type"), codes)
        self.assertIn((2, "score", "invalid_type"), codes)
        self.assertIn((2, "active", "invalid_type"), codes)


if __name__ == "__main__":
    unittest.main()
`,
    A3: `import unittest
from pycsv.filters import filter_rows


class TestA3Filters(unittest.TestCase):
    def test_filter_operators(self):
        rows = [
            {"city": "Recife", "amount": "10"},
            {"city": "Salvador", "amount": "25.5"},
            {"city": "Recife Sul", "amount": "40"},
        ]
        self.assertEqual(len(filter_rows(rows, "city==Recife")), 1)
        self.assertEqual(len(filter_rows(rows, "city!=Recife")), 2)
        self.assertEqual(len(filter_rows(rows, "amount>=25.5")), 2)
        self.assertEqual(len(filter_rows(rows, "amount<20")), 1)
        self.assertEqual(len(filter_rows(rows, "city~recife")), 2)

    def test_invalid_expr_raises(self):
        with self.assertRaises(ValueError):
            filter_rows([], "invalid_expr_without_op")


if __name__ == "__main__":
    unittest.main()
`,
    A4: `import unittest
from pycsv.normalize import normalize_rows


class TestA4Normalize(unittest.TestCase):
    def test_normalize_trim_drop_empty_and_lowercase(self):
        raw = [
            {"name": " Ana ", "email": " ANA@EX.COM "},
            {"name": "   ", "email": ""},
            {"name": "Bruno", "email": "BRUNO@EX.COM"},
        ]
        out = normalize_rows(raw, trim=True, drop_empty=True, lowercase_cols=("email",))
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0], {"name": "Ana", "email": "ana@ex.com"})
        self.assertEqual(raw[0]["name"], " Ana ")


if __name__ == "__main__":
    unittest.main()
`,
    A5: `import unittest
from pycsv.dedupe import dedupe_rows


class TestA5Dedupe(unittest.TestCase):
    def test_dedupe_preserves_first(self):
        rows = [
            {"id": "1", "val": "first"},
            {"id": "2", "val": "only"},
            {"id": "1", "val": "second"},
        ]
        res = dedupe_rows(rows, ["id"])
        self.assertEqual(res["duplicates"], 1)
        self.assertEqual(res["rows"], [{"id": "1", "val": "first"}, {"id": "2", "val": "only"}])


if __name__ == "__main__":
    unittest.main()
`,
  },
  oracle: `import unittest
from pycsv.parser import parse_csv
from pycsv.schema import validate_schema
from pycsv.filters import filter_rows
from pycsv.normalize import normalize_rows
from pycsv.dedupe import dedupe_rows


class OracleF1(unittest.TestCase):
    def test_oracle_f1_end_to_end(self):
        parsed = parse_csv('id,team,points\\n1, Alpha ,10\\n , , \\n2,Beta,30\\n1,Alpha,99\\n')
        norm = normalize_rows(parsed["rows"], trim=True, drop_empty=True, lowercase_cols=("team",))
        deduped = dedupe_rows(norm, ["id"])
        self.assertEqual(deduped["duplicates"], 1)
        self.assertEqual(len(deduped["rows"]), 2)
        errs = validate_schema(parsed["headers"], deduped["rows"], {"required": ["id", "points"], "types": {"id": "int", "points": "int"}})
        self.assertEqual(errs, [])
        high = filter_rows(deduped["rows"], "points>15")
        self.assertEqual(len(high), 1)
        self.assertEqual(high[0]["team"], "beta")


if __name__ == "__main__":
    unittest.main()
`,
};

const F2 = {
  id: 'F2',
  title: 'Agregação, formatação, estatísticas e CLI',
  scope: 'agregador por grupo, formatadores JSON/CSV, estatísticas numéricas, pipeline composicional e CLI com códigos de saída',
  tasks: [
    {
      id: 'T6', wave: 1, title: 'Agregação por coluna', files: ['src/pycsv/aggregate.py'], aceite: 'A6',
      criterion: 'aggregate agrupa por group_by e calcula count, sum, min, max e avg arredondados em 4 casas ordenados pela chave',
      goal: 'aggregate(rows, group_by, metric_col) devolve lista ordenada de dicts {"group", "count", "sum", "min", "max", "avg"}.',
      symbols: [['src/pycsv/aggregate.py', 'aggregate']],
      commit: 'feat(aggregate): group-by numeric aggregations',
    },
    {
      id: 'T7', wave: 1, title: 'Formatadores JSON e CSV', files: ['src/pycsv/formatters.py'], aceite: 'A7',
      criterion: 'format_json serializa com indentação 2 e format_csv gera CSV válido com quebra LF',
      goal: 'format_json(data) e format_csv(headers, rows) usando json.dumps e csv.writer com lineterminator="\\n".',
      symbols: [['src/pycsv/formatters.py', 'format_json'], ['src/pycsv/formatters.py', 'format_csv']],
      commit: 'feat(formatters): json and csv serializers',
    },
    {
      id: 'T8', wave: 1, title: 'Estatísticas de coluna numérica', files: ['src/pycsv/stats.py'], aceite: 'A8',
      criterion: 'column_stats calcula count, missing, min, max e mean para uma coluna numérica ignorando vazios',
      goal: 'column_stats(rows, col) devolve {"column", "count", "missing", "min", "max", "mean"}.',
      symbols: [['src/pycsv/stats.py', 'column_stats']],
      commit: 'feat(stats): numeric column summary statistics',
    },
    {
      id: 'T9', wave: 2, dependsOn: ['T6', 'T8'], title: 'Pipeline composicional', files: ['src/pycsv/pipeline.py'], aceite: 'A9',
      criterion: 'run_pipeline encadeia parse, normalize, filter, dedupe e opcionalmente aggregate/stats',
      goal: 'run_pipeline(text, options=None) aceita delimiter, filter_expr, dedupe_keys, group_by, metric_col e stats_col.',
      symbols: [['src/pycsv/pipeline.py', 'run_pipeline']],
      commit: 'feat(pipeline): composable csv processing pipeline',
    },
    {
      id: 'T10', wave: 3, dependsOn: ['T6', 'T7', 'T8', 'T9'], title: 'CLI pycsv com códigos de saída', files: ['src/pycsv/__init__.py', 'src/pycsv/cli.py'], aceite: 'A10',
      criterion: 'run_cli suporta validate, filter, aggregate e stats com --format json|csv retornando 0, 1 ou 2',
      goal: 'run_cli(argv, stdout=None, stderr=None) lê arquivo CSV, executa o subcomando e devolve 0 (ok), 1 (falha de validação) ou 2 (erro de uso/arquivo).',
      symbols: [['src/pycsv/cli.py', 'run_cli']],
      commit: 'feat(cli): pycsv cli with subcommands and exit codes',
    },
  ],
  acceptance: {
    A6: `import unittest
from pycsv.aggregate import aggregate


class TestA6Aggregate(unittest.TestCase):
    def test_aggregate_by_group(self):
        rows = [
            {"dept": "eng", "cost": "10"},
            {"dept": "ops", "cost": "20"},
            {"dept": "eng", "cost": "30"},
        ]
        out = aggregate(rows, "dept", "cost")
        self.assertEqual([g["group"] for g in out], ["eng", "ops"])
        self.assertEqual(out[0], {"group": "eng", "count": 2, "sum": 40.0, "min": 10.0, "max": 30.0, "avg": 20.0})
        self.assertEqual(out[1]["count"], 1)


if __name__ == "__main__":
    unittest.main()
`,
    A7: `import json
import unittest
from pycsv.formatters import format_json, format_csv


class TestA7Formatters(unittest.TestCase):
    def test_format_json_and_csv(self):
        rows = [{"a": "1", "b": "x,y"}]
        j = format_json(rows)
        self.assertEqual(json.loads(j), rows)
        c = format_csv(["a", "b"], rows)
        self.assertEqual(c, 'a,b\\n1,"x,y"\\n')


if __name__ == "__main__":
    unittest.main()
`,
    A8: `import unittest
from pycsv.stats import column_stats


class TestA8Stats(unittest.TestCase):
    def test_column_stats_with_missing(self):
        rows = [{"v": "10"}, {"v": ""}, {"v": "20"}, {"v": "30"}]
        st = column_stats(rows, "v")
        self.assertEqual(st, {"column": "v", "count": 3, "missing": 1, "min": 10.0, "max": 30.0, "mean": 20.0})


if __name__ == "__main__":
    unittest.main()
`,
    A9: `import unittest
from pycsv.pipeline import run_pipeline


class TestA9Pipeline(unittest.TestCase):
    def test_pipeline_filter_dedupe_and_aggregate(self):
        csv_text = "id,dept,cost\\n1,eng,10\\n1,eng,10\\n2,eng,30\\n3,ops,5\\n"
        out = run_pipeline(
            csv_text,
            {"dedupe_keys": ["id"], "filter_expr": "cost>=10", "group_by": "dept", "metric_col": "cost"},
        )
        self.assertEqual(out["duplicates"], 1)
        self.assertEqual(len(out["rows"]), 2)
        self.assertEqual(out["groups"][0]["sum"], 40.0)


if __name__ == "__main__":
    unittest.main()
`,
    A10: `import io
import json
import os
import tempfile
import unittest
from pycsv.cli import run_cli


class TestA10Cli(unittest.TestCase):
    def test_cli_subcommands_and_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_file = os.path.join(tmp, "sales.csv")
            with open(csv_file, "w", encoding="utf-8") as fh:
                fh.write("id,dept,amount\\n1,eng,10\\n2,eng,30\\n3,ops,20\\n")

            out, err = io.StringIO(), io.StringIO()
            code = run_cli(["aggregate", csv_file, "--group-by", "dept", "--metric", "amount", "--format", "json"], stdout=out, stderr=err)
            self.assertEqual(code, 0, err.getvalue())
            data = json.loads(out.getvalue())
            self.assertEqual(data[0]["group"], "eng")
            self.assertEqual(data[0]["sum"], 40.0)

            out2, err2 = io.StringIO(), io.StringIO()
            code2 = run_cli(["validate", csv_file, "--required", "id,missing_col"], stdout=out2, stderr=err2)
            self.assertEqual(code2, 1)

            out3, err3 = io.StringIO(), io.StringIO()
            code3 = run_cli(["stats", os.path.join(tmp, "nope.csv"), "--col", "amount"], stdout=out3, stderr=err3)
            self.assertEqual(code3, 2)


if __name__ == "__main__":
    unittest.main()
`,
  },
  oracle: `import io
import json
import os
import tempfile
import unittest
from pycsv.cli import run_cli
from pycsv.pipeline import run_pipeline


class OracleF2(unittest.TestCase):
    def test_oracle_f2_cli_and_pipeline(self):
        csv_text = "id,team,val\\n1,a,5\\n2,a,15\\n2,a,15\\n3,b,20\\n"
        res = run_pipeline(csv_text, {"dedupe_keys": ["id"], "stats_col": "val"})
        self.assertEqual(res["stats"]["mean"], 13.3333)
        with tempfile.TemporaryDirectory() as tmp:
            p = os.path.join(tmp, "in.csv")
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(csv_text)
            out, err = io.StringIO(), io.StringIO()
            code = run_cli(["filter", p, "--where", "val>=15", "--format", "csv"], stdout=out, stderr=err)
            self.assertEqual(code, 0, err.getvalue())
            self.assertIn("3,b,20", out.getvalue())
            out_j, err_j = io.StringIO(), io.StringIO()
            code_j = run_cli(["stats", p, "--col", "val", "--format", "json"], stdout=out_j, stderr=err_j)
            self.assertEqual(code_j, 0, err_j.getvalue())
            self.assertEqual(json.loads(out_j.getvalue())["max"], 20.0)


if __name__ == "__main__":
    unittest.main()
`,
};

module.exports = {
  name: 'pycsv',
  stack: 'python',
  description: 'CLI de validação, filtragem, agregação e estatísticas CSV em Python 3 stdlib.',
  objective: 'Processar arquivos CSV com validação de schema, filtros expressivos, deduplicação, agregação por grupo, estatísticas numéricas e CLI com saída JSON/CSV usando apenas Python 3 stdlib.',
  phases: [F1, F2],
};
