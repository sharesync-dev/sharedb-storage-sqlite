const expect = require('chai').expect;
const path = require('path');
const fs = require('fs');
const SqliteStorage = require('..');
const BetterSqliteAdapter = require('@sharesync/sharedb-storage-node-sqlite');
const CollectionPerTableStrategy = require('..').CollectionPerTableStrategy;
const { cleanupTestDatabases } = require('./test-cleanup');

describe('CollectionPerTableStrategy Inventory Management', function() {
  this.timeout(10000); // Increase timeout to 10 seconds

  after(function() {
    cleanupTestDatabases();
  });
  const testDbDir = path.join(__dirname, 'test-databases');
  const testDbFile = 'test-inventory.db';
  const testDbPath = path.join(testDbDir, testDbFile);

  beforeEach(function(done) {
    // Create test directory if it doesn't exist
    if (!fs.existsSync(testDbDir)) {
      fs.mkdirSync(testDbDir, { recursive: true });
    }
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    done();
  });

  afterEach(function(done) {
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    done();
  });

  it('should properly maintain inventory when writing documents', function(done) {
    const adapter = new BetterSqliteAdapter(testDbPath, {debug: false});
    const schemaStrategy = new CollectionPerTableStrategy({
      collectionConfig: {
        'term': {
          indexes: ['text', 'starred_at'],
          encryptedFields: []
        },
        'session': {
          indexes: ['device_id', 'started_at'],
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
      debug: true
    });

    console.log('Initializing storage...');
    storage.initialize(function(err, inventory) {
      console.log('Initialize callback, err:', err, 'inventory:', inventory);
      expect(err).to.be.null;
      expect(inventory).to.exist;
      
      // Create test documents
      const termDoc = {
        id: 'term/term1',
        payload: {
          collection: 'term',
          id: 'term1',
          text: 'hello',
          v: 1
        }
      };

      const sessionDoc = {
        id: 'session/session1',
        payload: {
          collection: 'session',
          id: 'session1',
          device_id: 'device1',
          v: 1
        }
      };

      // Write documents
      storage.writeRecords({docs: [termDoc, sessionDoc]}, function(writeErr) {
        if (writeErr) {
          console.error('Write error:', writeErr);
          done(writeErr);
          return;
        }
        expect(writeErr).to.not.exist;

        // Check inventory was updated correctly
        storage.readInventory(function(invErr, inv) {
          expect(invErr).to.not.exist;
          expect(inv).to.exist;
          expect(inv.payload).to.exist;
          expect(inv.payload.collections).to.exist;
          
          // Verify term entry in inventory
          expect(inv.payload.collections.term).to.exist;
          expect(inv.payload.collections.term['term/term1']).to.deep.equal({v: 1, p: false});
          
          // Verify session entry in inventory
          expect(inv.payload.collections.session).to.exist;
          expect(inv.payload.collections.session['session/session1']).to.deep.equal({v: 1, p: false});

          storage.close(done);
        });
      });
    });
  });

  it('should return null for non-existent documents', function(done) {
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

    storage.initialize(function(err) {
      expect(err).to.be.null;

      // Try to read non-existent document
      storage.readRecord('docs', 'term/nonexistent', function(payload) {
        expect(payload).to.be.null;
        
        storage.close(done);
      });
    });
  });

  it('should update inventory when documents are updated', function(done) {
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

    storage.initialize(function(err) {
      expect(err).to.be.null;
      
      const termDoc = {
        id: 'term/term1',
        payload: {
          collection: 'term',
          id: 'term1',
          text: 'v1',
          v: 1
        }
      };

      // Write initial version
      storage.writeRecords({docs: [termDoc]}, function(writeErr1) {
        expect(writeErr1).to.not.exist;

        // Update document
        termDoc.payload.text = 'v2';
        termDoc.payload.v = 2;

        storage.writeRecords({docs: [termDoc]}, function(writeErr2) {
          expect(writeErr2).to.not.exist;

          // Check inventory was updated with new version
          storage.readInventory(function(invErr, inv) {
            expect(invErr).to.not.exist;
            expect(inv.payload.collections.term['term/term1']).to.deep.equal({v: 2, p: false});

            storage.close(done);
          });
        });
      });
    });
  });

  it('should handle bulk reads with inventory lookups', function(done) {
    const adapter = new BetterSqliteAdapter(testDbPath, {debug: false});
    const schemaStrategy = new CollectionPerTableStrategy({
      collectionConfig: {
        'term': {
          indexes: [],
          encryptedFields: []
        },
        'session': {
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

    storage.initialize(function(err) {
      expect(err).to.be.null;

      const docs = [
        {
          id: 'term/term1',
          payload: { collection: 'term', id: 'term1', text: 'hello', v: 1 }
        },
        {
          id: 'term/term2',
          payload: { collection: 'term', id: 'term2', text: 'world', v: 1 }
        },
        {
          id: 'session/session1',
          payload: { collection: 'session', id: 'session1', device: 'dev1', v: 1 }
        }
      ];

      // Write documents
      storage.writeRecords({docs: docs}, function(writeErr) {
        expect(writeErr).to.not.exist;

        // With CollectionPerTableStrategy, we need to read from each collection separately
        const termIdsToRead = ['term/term1', 'term/nonexistent', 'term/term2'];
        const sessionIdsToRead = ['session/session1'];

        // Read term documents
        storage.readRecordsBulk('term', termIdsToRead, function(termErr, termRecords) {
          expect(termErr).to.not.exist;
          expect(termRecords).to.have.lengthOf(2); // Only 2 exist

          // Verify term documents
          const termRecordsById = {};
          termRecords.forEach(r => termRecordsById[r.id] = r);

          expect(termRecordsById['term/term1']).to.exist;
          expect(termRecordsById['term/term1'].payload.text).to.equal('hello');

          expect(termRecordsById['term/term2']).to.exist;
          expect(termRecordsById['term/term2'].payload.text).to.equal('world');

          expect(termRecordsById['term/nonexistent']).to.not.exist;

          // Read session documents
          storage.readRecordsBulk('session', sessionIdsToRead, function(sessionErr, sessionRecords) {
            expect(sessionErr).to.not.exist;
            expect(sessionRecords).to.have.lengthOf(1);

            expect(sessionRecords[0].id).to.equal('session/session1');
            expect(sessionRecords[0].payload.device).to.equal('dev1');

            storage.close(done);
          });
        });
      });
    });
  });

  it('should properly clean up inventory when documents are deleted', function(done) {
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

    storage.initialize(function(err) {
      expect(err).to.be.null;
      
      const termDoc = {
        id: 'term/term1',
        payload: {
          collection: 'term',
          id: 'term1',
          text: 'test',
          v: 1
        }
      };

      // Write document
      storage.writeRecords({docs: [termDoc]}, function(writeErr) {
        expect(writeErr).to.not.exist;

        // Delete document
        storage.deleteRecord('term', 'term/term1', function(delErr) {
          expect(delErr).to.not.exist;

          // Check inventory was updated
          storage.readInventory(function(invErr, inv) {
            expect(invErr).to.not.exist;
            
            // Term should either not exist in inventory or be empty
            if (inv.payload.collections.term) {
              expect(inv.payload.collections.term['term/term1']).to.not.exist;
            }

            // Try to read deleted document
            storage.readRecord('docs', 'term/term1', function(payload) {
              expect(payload).to.be.null;
              
              storage.close(done);
            });
          });
        });
      });
    });
  });
});