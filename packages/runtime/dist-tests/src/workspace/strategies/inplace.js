"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InplaceWorkspaceManager = void 0;
const crypto_1 = __importDefault(require("crypto"));
class InplaceWorkspaceManager {
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
        this.isolation_level = 'shared';
    }
    async allocate(req) {
        return {
            workspace_id: `ws-inplace-${req.work_item_id}-a${req.attempt_number}`,
            strategy: 'inplace',
            isolation_level: this.isolation_level,
            branch: null,
            base_commit: null,
            root_path: this.projectRoot,
            ttl_minutes: 60,
        };
    }
    async snapshot(id) {
        return {
            snapshot_id: `snap-${crypto_1.default.randomBytes(4).toString('hex')}`,
            workspace_id: id,
            commit: 'HEAD',
            created_at: new Date().toISOString(),
        };
    }
    async reset(_id, _snapRef) {
        // inplace: no filesystem isolation — reset is a no-op
    }
    async dispose(_id) {
        // inplace: nothing to tear down
    }
}
exports.InplaceWorkspaceManager = InplaceWorkspaceManager;
