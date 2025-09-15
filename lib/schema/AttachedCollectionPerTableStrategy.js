"use strict";
/**
 * AttachedCollectionPerTableStrategy - Creates collection-specific tables attached to the main database
 * This strategy is designed for environments where you want to keep all ShareDB data in the same
 * database file, but still benefit from collection-specific tables and projections.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttachedCollectionPerTableStrategy = void 0;
const CollectionPerTableStrategy_1 = require("./CollectionPerTableStrategy");
class AttachedCollectionPerTableStrategy extends CollectionPerTableStrategy_1.CollectionPerTableStrategy {
    constructor(options = {}) {
        super(options);
    }
    /**
     * Initialize the schema - creates meta table, inventory table, and any pre-configured collection tables
     * This version doesn't use ATTACH DATABASE since everything is in the same database
     */
    async initializeSchema(db, callback) {
        try {
            // Create meta table
            await this.runAsync(db, `
        CREATE TABLE IF NOT EXISTS sharedb_meta (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL
        )
      `);
            // Create inventory table
            await this.runAsync(db, `
        CREATE TABLE IF NOT EXISTS sharedb_inventory (
          doc_id TEXT NOT NULL,
          collection TEXT NOT NULL,
          version INTEGER NOT NULL,
          last_operation TEXT NOT NULL,
          updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
          PRIMARY KEY (doc_id, collection)
        )
      `);
            // Create indexes on inventory
            await this.runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_collection ON sharedb_inventory(collection)');
            await this.runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_updated ON sharedb_inventory(updated_at)');
            // Create pre-configured collection tables and their projections
            if (this.collectionConfig) {
                for (const collection of Object.keys(this.collectionConfig)) {
                    await this.createCollectionTable(db, collection);
                    await this.createProjectionTables(db, collection);
                }
            }
            callback?.();
        }
        catch (error) {
            callback?.(error);
            throw error;
        }
    }
    /**
     * Validate that required tables exist
     * For attached strategy, we check tables in the main database
     */
    async validateSchema(db, callback) {
        try {
            // Check for meta table
            const metaExists = await db.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='sharedb_meta'");
            // Check for inventory table
            const inventoryExists = await db.getFirstAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='sharedb_inventory'");
            const isValid = !!(metaExists && inventoryExists);
            callback?.(null, isValid);
            return isValid;
        }
        catch (error) {
            callback?.(error, false);
            return false;
        }
    }
    /**
     * Delete all tables
     * For attached strategy, we drop tables from the main database
     */
    async deleteAllTables(db, callback) {
        try {
            // Get all ShareDB-related tables
            const tables = await db.getAllAsync("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'sharedb_%' OR name LIKE 'projection_%')");
            // Drop each table
            for (const table of tables) {
                await this.runAsync(db, `DROP TABLE IF EXISTS ${table.name}`);
            }
            // Clear the created tables tracking
            this.createdTables = {};
            callback?.();
        }
        catch (error) {
            callback?.(error);
            throw error;
        }
    }
    /**
     * Helper to run async SQL with consistent promise handling
     * Override to ensure we're working with the main database
     */
    async runAsync(db, sql, params) {
        return db.runAsync(sql, params || []);
    }
}
exports.AttachedCollectionPerTableStrategy = AttachedCollectionPerTableStrategy;
//# sourceMappingURL=AttachedCollectionPerTableStrategy.js.map