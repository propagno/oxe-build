import type { Action } from '../compiler/graph-compiler';
import { ALL_BUILT_IN_SCHEMAS, BUILT_IN_TOOLS } from './built-in-tools';
import type { ToolSchema } from './stream-completion';

const READ_TOOLS: ToolSchema[] = [
  BUILT_IN_TOOLS.read_file.schema,
  BUILT_IN_TOOLS.glob.schema,
  BUILT_IN_TOOLS.grep.schema,
];

const PATCH_TOOLS: ToolSchema[] = [
  BUILT_IN_TOOLS.read_file.schema,
  BUILT_IN_TOOLS.write_file.schema,
  BUILT_IN_TOOLS.patch_file.schema,
];

const RUN_TOOLS: ToolSchema[] = [BUILT_IN_TOOLS.run_command.schema];

const EVIDENCE_TOOLS: ToolSchema[] = [
  BUILT_IN_TOOLS.read_file.schema,
  BUILT_IN_TOOLS.glob.schema,
  BUILT_IN_TOOLS.run_command.schema,
];

const ACTION_TOOL_MAP: Record<Action['type'], ToolSchema[]> = {
  read_code: READ_TOOLS,
  generate_patch: PATCH_TOOLS,
  run_tests: RUN_TOOLS,
  run_lint: RUN_TOOLS,
  collect_evidence: EVIDENCE_TOOLS,
  custom: ALL_BUILT_IN_SCHEMAS,
};

export function selectToolsForActions(actions: Action[]): ToolSchema[] {
  const seen = new Set<string>();
  const result: ToolSchema[] = [];
  for (const action of actions) {
    for (const tool of ACTION_TOOL_MAP[action.type] ?? ALL_BUILT_IN_SCHEMAS) {
      if (!seen.has(tool.function.name)) {
        seen.add(tool.function.name);
        result.push(tool);
      }
    }
  }
  return result;
}
