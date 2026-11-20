'use strict';

/**
 * EARS (Easy Approach to Requirements Syntax) & ambiguity validator for SPEC.md criteria.
 * Recognizes English and Portuguese EARS patterns:
 *  - Ubiquitous:  "The <system> shall ..." / "O <sistema> deve ..."
 *  - Event-driven: "When <trigger>, ... shall ..." / "Quando <evento>, ... deve ..."
 *  - State-driven: "While <state>, ... shall ..." / "Enquanto <estado>, ... deve ..."
 *  - Optional:     "Where <feature>, ... shall ..." / "Onde <recurso>, ... deve ..."
 *  - Unwanted:     "If <condition>, then ... shall ..." / "Se <condição>, ... deve ..."
 */

const EARS_PATTERN_RE = /\b(?:when|while|where|if|quando|enquanto|onde|se|dado\s+que)\b.+\b(?:shall|must|deve|deverá|retorna|bloqueia|exibe|grava|emite)\b|\b(?:the\s+\w+\s+shall|o\s+\w+\s+deve|a\s+\w+\s+deve)\b/i;

const AMBIGUOUS_TERMS = [
  { re: /\b(?:r[aá]pido|fast|quick(?:ly)?|perform[aá]tico)\b/i, hint: 'defina latência/tempo mensurável (ex.: <= 200ms)' },
  { re: /\b(?:f[aá]cil|easy|intuitiv[oa]|user-friendly|seamless)\b/i, hint: 'defina comportamento observável/testável em vez de adjetivo subjetivo' },
  { re: /\b(?:adequad[oa]|apropriad[oa]|appropriate|reasonable|sufficient)\b/i, hint: 'substitua por critério objetivo verificável' },
  { re: /\b(?:etc\.?|entre\s+outros|and\s+so\s+on)\b/i, hint: 'liste explicitamente todos os casos esperados (evite "etc.")' },
];

/**
 * Extract acceptance criteria rows (| A1 | ... |) or bullet requirements from SPEC.md text.
 * @param {string} specText
 */
function extractSpecCriteria(specText) {
  const out = [];
  const lines = String(specText || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const tableMatch = /^\|\s*(A\d+|RF-\d+|CA-\d+|R\d+)\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (tableMatch) {
      out.push({ id: tableMatch[1].trim(), text: tableMatch[2].trim(), line: i + 1 });
      continue;
    }
    const bulletMatch = /^\s*[-*]\s+\*{0,2}(A\d+|RF-\d+|CA-\d+)\*{0,2}\s*[:—-]\s*(.+)$/.exec(line);
    if (bulletMatch) {
      out.push({ id: bulletMatch[1].trim(), text: bulletMatch[2].trim(), line: i + 1 });
    }
  }
  return out;
}

/**
 * Validate SPEC.md criteria for EARS compliance and ambiguous wording.
 * @param {string} specText
 * @param {{ strictEars?: boolean }} [options]
 */
function validateSpecEars(specText, options = {}) {
  const criteria = extractSpecCriteria(specText);
  const issues = [];
  let earsCompliant = 0;

  for (const c of criteria) {
    const isEars = EARS_PATTERN_RE.test(c.text);
    if (isEars) {
      earsCompliant += 1;
    } else {
      issues.push({
        id: c.id,
        line: c.line,
        severity: options.strictEars ? 'error' : 'warning',
        kind: 'ears_format',
        message: `${c.id}: critério fora do padrão EARS (ex.: "Quando <gatilho>, o sistema deve <resposta>")`,
      });
    }
    for (const term of AMBIGUOUS_TERMS) {
      const m = term.re.exec(c.text);
      if (m) {
        issues.push({
          id: c.id,
          line: c.line,
          severity: 'warning',
          kind: 'ambiguous_term',
          term: m[0],
          message: `${c.id}: termo ambíguo "${m[0]}" — ${term.hint}`,
        });
      }
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return {
    ok: errors.length === 0,
    total_criteria: criteria.length,
    ears_compliant: earsCompliant,
    ears_ratio: criteria.length ? Number((earsCompliant / criteria.length).toFixed(2)) : 1,
    errors,
    warnings,
    issues,
  };
}

module.exports = {
  extractSpecCriteria,
  validateSpecEars,
};
