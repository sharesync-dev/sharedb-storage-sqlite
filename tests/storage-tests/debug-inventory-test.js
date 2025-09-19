const expect = require('chai').expect;
const path = require('path');
const fs = require('fs');
const SqliteStorage = require('..');
const BetterSqliteAdapter = require('@shaxpir/sharedb-storage-node-sqlite');
const CollectionPerTableStrategy = require('..').CollectionPerTableStrategy;
const { cleanupTestDatabases } = require('./test-cleanup');

describe('Debug Inventory', function() {
  this.timeout(10000);

  after(function() {
    cleanupTestDatabases();
  });
  
  it('should check inventory after write', function(done) {
    const testDbDir = path.join(__dirname, 'test-databases');
    const testDbFile = 'debug-inventory.db';
    const testDbPath = path.join(testDbDir, testDbFile);
    
    // Clean up
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (!fs.existsSync(testDbDir)) {
      fs.mkdirSync(testDbDir, { recursive: true });
    }
    
    const adapter = new BetterSqliteAdapter(testDbPath, {debug: false});
    const schemaStrategy = new CollectionPerTableStrategy({
      collectionConfig: {
        'term': {
          indexes: [],
          encryptedFields: []
        }
      },
      debug: false
    });

    const storage = new SqliteStorage({
      adapter: adapter,
      schemaStrategy: schemaStrategy,
      dbFileName: testDbFile,
      dbFileDir: testDbDir,
      debug: false
    });

    storage.initialize(function(err, inventory) {
      expect(err).to.be.null;
      
      const termDoc = {
        id: 'term/term1',
        payload: {
          collection: 'term',
          id: 'term1',
          text: 'hello',
          v: 1
        }
      };

      console.log('Writing document...');
      storage.writeRecords({docs: [termDoc]}, function(writeErr) {
        expect(writeErr).to.not.exist;
        console.log('Write completed');
        
        // Check what's actually in the inventory table
        const db = adapter.db;
        const inventoryRows = db.prepare('SELECT * FROM sharedb_inventory').all();
        console.log('Inventory table contents:', inventoryRows);
        
        // Check what's in the term table (CollectionPerTableStrategy no longer uses 'collection_' prefix)
        const termRows = db.prepare('SELECT * FROM term').all();
        console.log('Term table contents:', termRows);
        
        // Now try reading through the API
        console.log('Reading through API...');
        storage.readRecord('term', 'term/term1', function(payload) {
          console.log('Read result:', payload);

          storage.close(done);
        });
      });
    });
  });
});