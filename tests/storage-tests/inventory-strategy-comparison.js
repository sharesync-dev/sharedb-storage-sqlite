const expect = require('chai').expect;
const path = require('path');
const fs = require('fs');
const SqliteStorage = require('..');
const BetterSqliteAdapter = require('@shaxpir/sharedb-storage-node-sqlite');
const DefaultSchemaStrategy = require('..').DefaultSchemaStrategy;
const CollectionPerTableStrategy = require('..').CollectionPerTableStrategy;

describe('Inventory Strategy Comparison', function() {
  this.timeout(10000);
  const testDbDir = path.join(__dirname, 'test-databases');
  
  beforeEach(function() {
    if (!fs.existsSync(testDbDir)) {
      fs.mkdirSync(testDbDir, { recursive: true });
    }
  });
  
  describe('Original DurableStore approach (single JSON)', function() {
    it('stores inventory as a single meta document', function() {
      // This is how DurableStore does it:
      // 1. Maintains inventory in memory as this.inventory
      // 2. When persisting, writes both docs AND the entire inventory as meta record
      // 3. On startup, reads the inventory meta record
      
      const inventory = {
        id: 'inventory',
        payload: {
          collections: {
            'term': {
              'term/term1': { v: 1, p: false },
              'term/term2': { v: 2, p: true }
            },
            'session': {
              'session/s1': { v: 1, p: false }
            }
          }
        }
      };
      
      console.log('DurableStore inventory structure:');
      console.log(JSON.stringify(inventory, null, 2));
      
      // Key characteristics:
      // - Atomic updates (entire inventory written at once)
      // - Easy to read/write
      // - Can become large with many documents
      // - Single source of truth
      expect(inventory.payload.collections).to.exist;
    });
  });
  
  describe('DefaultSchemaStrategy approach', function() {
    it('also stores inventory as single JSON in meta table', function(done) {
    const testDbPath = path.join(__dirname, 'test-databases', 'inventory-strategy-comparison.db');
      const adapter = new BetterSqliteAdapter(testDbPath, {debug: false});
      const storage = new SqliteStorage({
        adapter: adapter,
        schemaStrategy: new DefaultSchemaStrategy({debug: false}),
        dbFileName: 'default-inv.db',
        dbFileDir: testDbDir,
        debug: false
      });
      
      storage.initialize(function(err, initialInventory) {
        expect(err).to.be.null;
        
        console.log('\nDefaultSchemaStrategy initial inventory:');
        console.log(JSON.stringify(initialInventory, null, 2));
        
        // Manually update inventory (normally done by DurableStore)
        storage.updateInventory('posts', 'post1', 1, 'add', function(err1) {
          expect(err1).to.not.exist;
          
          storage.readInventory(function(err2, inv) {
            expect(err2).to.not.exist;
            
            console.log('After update:');
            console.log(JSON.stringify(inv, null, 2));
            
            // Key characteristics:
            // - Same as DurableStore (single JSON document)
            // - updateInventory reads, modifies, writes entire document
            // - Atomic at document level
            expect(inv.payload.collections.posts).to.exist;
            
            storage.close(done);
          });
        });
      });
    });
  });
  
  describe('CollectionPerTableStrategy approach', function() {
    it('stores inventory as individual rows in sharedb_inventory table', function(done) {
      const adapter = new BetterSqliteAdapter(testDbPath, {debug: false});
      const storage = new SqliteStorage({
        adapter: adapter,
        schemaStrategy: new CollectionPerTableStrategy({
          collectionConfig: {
            'term': { indexes: [], encryptedFields: [] }
          },
          debug: false
        }),
        dbFileName: 'collection-inv.db',
        dbFileDir: testDbDir,
        debug: false
      });
      
      storage.initialize(function(err, initialInventory) {
        expect(err).to.be.null;
        
        console.log('\nCollectionPerTableStrategy initial inventory:');
        console.log(JSON.stringify(initialInventory, null, 2));
        
        // Write a document (this automatically updates inventory table)
        const doc = {
          id: 'term/term1',
          payload: {
            collection: 'term',
            id: 'term1',
            text: 'hello',
            v: 1
          }
        };
        
        storage.writeRecords({docs: [doc]}, function(writeErr) {
          if (writeErr) {
            console.error('Write error:', writeErr);
            done(writeErr);
            return;
          }
          
          // Read inventory after write
          storage.readInventory(function(invErr, inv) {
            console.log('After write, readInventory returns:');
            console.log(JSON.stringify(inv, null, 2));
            
            // Check what's actually in the table
            const db = adapter.db;
            const rows = db.prepare('SELECT * FROM sharedb_inventory').all();
            console.log('\nActual sharedb_inventory table rows:');
            console.log(rows);
            
            // Key characteristics:
            // - Inventory stored as separate rows per document
            // - readInventory reconstructs JSON from rows
            // - writeRecords automatically inserts/updates rows
            // - NOT atomic - individual row updates
            // - Potential race conditions
            // - Different data model from DurableStore
            
            storage.close(done);
          });
        });
      });
    });
  });
  
  describe('The fundamental mismatch', function() {
    it('highlights the conceptual difference', function() {
      console.log('\n=== FUNDAMENTAL MISMATCH ===\n');
      
      console.log('DurableStore & DefaultSchemaStrategy:');
      console.log('- Inventory is a DOCUMENT (single JSON)');
      console.log('- Updated atomically by DurableStore');
      console.log('- Storage just stores/retrieves it');
      console.log('- DurableStore owns inventory management');
      console.log('');
      
      console.log('CollectionPerTableStrategy:');
      console.log('- Inventory is a TABLE (multiple rows)');
      console.log('- Updated per-document during writes');
      console.log('- Storage owns inventory management');
      console.log('- Reconstructs JSON for compatibility');
      console.log('');
      
      console.log('PROBLEM: CollectionPerTableStrategy tries to be both!');
      console.log('- Maintains table for per-doc tracking');
      console.log('- But also provides JSON interface for DurableStore');
      console.log('- This dual approach creates inconsistencies');
      
      expect(true).to.be.true;
    });
  });
});