"use strict";
/**
 * @shaxpir/sharedb-storage-sqlite
 *
 * Shared SQLite storage components for ShareDB adapters
 * Provides schema strategies and base classes for SQLite-based
 * offline storage in both Node.js and React Native environments.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERSION = exports.CollectionPerTableStrategy = exports.BaseSchemaStrategy = exports.SqliteStorage = void 0;
// Export all interfaces
__exportStar(require("./interfaces"), exports);
// Export base storage class
var SqliteStorage_1 = require("./SqliteStorage");
Object.defineProperty(exports, "SqliteStorage", { enumerable: true, get: function () { return SqliteStorage_1.SqliteStorage; } });
// Export schema strategies
var BaseSchemaStrategy_1 = require("./schema/BaseSchemaStrategy");
Object.defineProperty(exports, "BaseSchemaStrategy", { enumerable: true, get: function () { return BaseSchemaStrategy_1.BaseSchemaStrategy; } });
var CollectionPerTableStrategy_1 = require("./schema/CollectionPerTableStrategy");
Object.defineProperty(exports, "CollectionPerTableStrategy", { enumerable: true, get: function () { return CollectionPerTableStrategy_1.CollectionPerTableStrategy; } });
// Future exports will include:
// export { AttachedCollectionPerTableStrategy } from './schema/AttachedCollectionPerTableStrategy';
// export { DefaultSchemaStrategy } from './schema/DefaultSchemaStrategy';
// Export utilities and helpers
// export * from './utils';
// Version
exports.VERSION = '1.0.0';
//# sourceMappingURL=index.js.map