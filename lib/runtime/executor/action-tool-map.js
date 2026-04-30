"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectToolsForActions = selectToolsForActions;
const built_in_tools_1 = require("./built-in-tools");
const READ_TOOLS = [
    built_in_tools_1.BUILT_IN_TOOLS.read_file.schema,
    built_in_tools_1.BUILT_IN_TOOLS.glob.schema,
    built_in_tools_1.BUILT_IN_TOOLS.grep.schema,
];
const PATCH_TOOLS = [
    built_in_tools_1.BUILT_IN_TOOLS.read_file.schema,
    built_in_tools_1.BUILT_IN_TOOLS.write_file.schema,
    built_in_tools_1.BUILT_IN_TOOLS.patch_file.schema,
];
const RUN_TOOLS = [built_in_tools_1.BUILT_IN_TOOLS.run_command.schema];
const EVIDENCE_TOOLS = [
    built_in_tools_1.BUILT_IN_TOOLS.read_file.schema,
    built_in_tools_1.BUILT_IN_TOOLS.glob.schema,
    built_in_tools_1.BUILT_IN_TOOLS.run_command.schema,
];
const ACTION_TOOL_MAP = {
    read_code: READ_TOOLS,
    generate_patch: PATCH_TOOLS,
    run_tests: RUN_TOOLS,
    run_lint: RUN_TOOLS,
    collect_evidence: EVIDENCE_TOOLS,
    custom: built_in_tools_1.ALL_BUILT_IN_SCHEMAS,
};
function selectToolsForActions(actions) {
    const seen = new Set();
    const result = [];
    for (const action of actions) {
        for (const tool of ACTION_TOOL_MAP[action.type] ?? built_in_tools_1.ALL_BUILT_IN_SCHEMAS) {
            if (!seen.has(tool.function.name)) {
                seen.add(tool.function.name);
                result.push(tool);
            }
        }
    }
    // finish_task is always available so the LLM can signal authoritative completion
    if (!seen.has('finish_task') && built_in_tools_1.BUILT_IN_TOOLS.finish_task) {
        result.push(built_in_tools_1.BUILT_IN_TOOLS.finish_task.schema);
    }
    return result;
}
