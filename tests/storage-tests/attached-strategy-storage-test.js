/**
 * Tests for AttachedCollectionPerTableStrategy and SqliteStorage with attached databases
 * Moved from sharedb-storage-node-sqlite/test/attached-adapter-test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { BetterSqliteAdapter, AttachedBetterSqliteAdapter } = require('@shaxpir/sharedb-storage-node-sqlite');
const { SqliteStorage, AttachedCollectionPerTableStrategy } = require('../..');
const { cleanupTestDatabases } = require('./test-cleanup');

describe('AttachedCollectionPerTableStrategy and SqliteStorage', function() {
  const TEST_DIR = path.join(__dirname, 'test-databases');
  const PRIMARY_DB = path.join(TEST_DIR, 'test-primary.db');
  const ATTACHED_DB = path.join(TEST_DIR, 'test-attached.db');

  // Ensure test directory exists
  before(function() {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  // Clean up test databases after each test
  afterEach(function() {
    try {
      if (fs.existsSync(PRIMARY_DB)) fs.unlinkSync(PRIMARY_DB);
      if (fs.existsSync(ATTACHED_DB)) fs.unlinkSync(ATTACHED_DB);
    } catch (e) {
      // Ignore errors during cleanup
    }
  });

  after(function() {
    cleanupTestDatabases();
  });

  describe('AttachedCollectionPerTableStrategy', function() {
    it('should initialize schema in attached database', async function() {
      // Create attached adapter
      const adapter = new AttachedBetterSqliteAdapter(
        PRIMARY_DB,
        {
          attachments: [
            { path: ATTACHED_DB, alias: 'sharedb' }
          ]
        },
        { debug: false }
      );

      await adapter.connect();

      // Create strategy with attachment alias
      const strategy = new AttachedCollectionPerTableStrategy({
        attachmentAlias: 'sharedb',
        collectionConfig: {
          'users': {
            indexes: ['email'],
            encryptedFields: []
          }
        }
      });

      // Initialize schema
      await new Promise((resolve, reject) => {
        strategy.initializeSchema(adapter, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Verify tables were created in attached database
      const inventoryTable = await adapter.getFirstAsync(
        "SELECT name FROM sharedb.sqlite_master WHERE type='table' AND name='sharedb_inventory'"
      );
      assert(inventoryTable);

      const usersTable = await adapter.getFirstAsync(
        "SELECT name FROM sharedb.sqlite_master WHERE type='table' AND name='users'"
      );
      assert(usersTable);

      await adapter.disconnect();
    });

    it('should prefix table names correctly', function() {
      const strategy = new AttachedCollectionPerTableStrategy({
        attachmentAlias: 'sharedb'
      });

      assert.strictEqual(strategy.getTableName('users'), 'sharedb.users');
      assert.strictEqual(strategy.getTableName('__inventory__'), 'sharedb.sharedb_inventory');
    });

    it('should work with SqliteStorage', async function() {
      // Create attached adapter
      const adapter = new AttachedBetterSqliteAdapter(
        PRIMARY_DB,
        {
          attachments: [
            { path: ATTACHED_DB, alias: 'sharedb' }
          ]
        },
        { debug: false }
      );

      // Create strategy with attachment alias
      const strategy = new AttachedCollectionPerTableStrategy({
        attachmentAlias: 'sharedb',
        collectionConfig: {}
      });

      // Create storage with attached adapter and strategy
      const storage = new SqliteStorage({
        adapter: adapter,
        schemaStrategy: strategy
      });

      await new Promise((resolve, reject) => {
        storage.initialize((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Verify that storage is initialized and working
      assert(storage.isReady());

      // Test that we can interact with the attached database
      // Simply verify that the tables were created in the attached database
      const tables = await adapter.getAllAsync(
        "SELECT name FROM sharedb.sqlite_master WHERE type='table' ORDER BY name"
      );

      // Should have at least the inventory table
      const tableNames = tables.map(t => t.name);
      assert(tableNames.includes('sharedb_inventory'));

      await new Promise((resolve, reject) => {
        storage.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  });

  describe('Automatic Pre-initialization', function() {
    it('should automatically initialize ShareDB database with indexes before attachment', async function() {
      // Create a fresh ShareDB database path (doesn't exist yet)
      const FRESH_SHAREDB_DB = path.join(TEST_DIR, 'fresh-sharedb.db');

      try {
        // Ensure it doesn't exist
        if (fs.existsSync(FRESH_SHAREDB_DB)) {
          fs.unlinkSync(FRESH_SHAREDB_DB);
        }

        // Create primary database
        const primaryAdapter = new BetterSqliteAdapter(PRIMARY_DB);
        await primaryAdapter.connect();
        await primaryAdapter.runAsync('CREATE TABLE main_table (id INTEGER PRIMARY KEY)');
        await primaryAdapter.disconnect();

        // Create attached adapter with a strategy
        const adapter = new AttachedBetterSqliteAdapter(
          PRIMARY_DB,
          {
            attachments: [
              { path: FRESH_SHAREDB_DB, alias: 'sharedb' }
            ]
          },
          { debug: false }
        );

        // Create strategy with collection config that includes indexes
        // Using realistic field paths that match actual ShareDB document structure
        const strategy = new AttachedCollectionPerTableStrategy({
          attachmentAlias: 'sharedb',
          collectionConfig: {
            'test_collection': {
              indexes: ['payload.data.field1', 'payload.data.field2', 'payload.data.field3'],
              encryptedFields: []
            }
          }
        });

        // Create storage - this should trigger automatic initialization
        const storage = new SqliteStorage({
          adapter: adapter,
          schemaStrategy: strategy
        });

        // Initialize storage
        await new Promise((resolve, reject) => {
          storage.initialize((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Verify the ShareDB database was created with indexes
        const indexes = await adapter.getAllAsync(
          "SELECT name FROM sharedb.sqlite_master WHERE type='index' ORDER BY name"
        );

        const indexNames = indexes.map(i => i.name);

        // Debug output to see what indexes were actually created
        console.log('[Test] Indexes found in attached database:', indexNames);

        // Should have inventory indexes
        assert(indexNames.includes('idx_inventory_collection'));
        assert(indexNames.includes('idx_inventory_updated'));

        // Should have collection indexes with idx_ prefix and payload.data in the path
        assert(indexNames.includes('idx_test_collection_payload_data_field1'));
        assert(indexNames.includes('idx_test_collection_payload_data_field2'));
        assert(indexNames.includes('idx_test_collection_payload_data_field3'));

        // Verify tables were created
        const tables = await adapter.getAllAsync(
          "SELECT name FROM sharedb.sqlite_master WHERE type='table' ORDER BY name"
        );

        const tableNames = tables.map(t => t.name);
        console.log('[Test] Tables found in attached database:', tableNames);

        assert(tableNames.includes('sharedb_inventory'));
        assert(tableNames.includes('test_collection'));

        await new Promise((resolve, reject) => {
          storage.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } finally {
        // Cleanup
        if (fs.existsSync(FRESH_SHAREDB_DB)) {
          fs.unlinkSync(FRESH_SHAREDB_DB);
        }
      }
    });

    it('should handle pre-existing initialized databases correctly', async function() {
      // First, create and initialize a ShareDB database
      const sharedbAdapter = new BetterSqliteAdapter(ATTACHED_DB);
      await sharedbAdapter.connect();
      await sharedbAdapter.runAsync('CREATE TABLE sharedb_inventory (collection TEXT, doc_id TEXT, version_num REAL, version_str TEXT, has_pending INTEGER, updated_at INTEGER, PRIMARY KEY(collection, doc_id))');
      await sharedbAdapter.runAsync('CREATE INDEX idx_inventory_collection ON sharedb_inventory (collection)');
      await sharedbAdapter.runAsync('CREATE INDEX idx_inventory_updated ON sharedb_inventory (updated_at)');
      await sharedbAdapter.disconnect();

      // Create primary database
      const primaryAdapter = new BetterSqliteAdapter(PRIMARY_DB);
      await primaryAdapter.connect();
      await primaryAdapter.runAsync('CREATE TABLE main_table (id INTEGER PRIMARY KEY)');
      await primaryAdapter.disconnect();

      // Now use it with attachment mode - it should detect existing indexes
      const adapter = new AttachedBetterSqliteAdapter(
        PRIMARY_DB,
        {
          attachments: [
            { path: ATTACHED_DB, alias: 'sharedb' }
          ]
        },
        { debug: false }
      );

      const strategy = new AttachedCollectionPerTableStrategy({
        attachmentAlias: 'sharedb',
        collectionConfig: {}
      });

      const storage = new SqliteStorage({
        adapter: adapter,
        schemaStrategy: strategy
      });

      await new Promise((resolve, reject) => {
        storage.initialize((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Verify indexes still exist and weren't recreated
      const indexes = await adapter.getAllAsync(
        "SELECT name FROM sharedb.sqlite_master WHERE type='index'"
      );

      const indexNames = indexes.map(i => i.name);
      assert(indexNames.includes('idx_inventory_collection'));
      assert(indexNames.includes('idx_inventory_updated'));

      await new Promise((resolve, reject) => {
        storage.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  });
});