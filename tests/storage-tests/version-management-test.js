const expect = require('chai').expect;
const path = require('path');
const fs = require('fs');
const SqliteStorage = require('..');
const BetterSqliteAdapter = require('@sharesync/sharedb-storage-node-sqlite');
const DefaultSchemaStrategy = require('..').DefaultSchemaStrategy;
const CollectionPerTableStrategy = require('..').CollectionPerTableStrategy;
const { cleanupTestDatabases } = require('./test-cleanup');

describe('Version Management', function() {
  const testDbDir = path.join(__dirname, 'test-databases');

  after(function() {
    cleanupTestDatabases();
  });
  
  beforeEach(function() {
    if (!fs.existsSync(testDbDir)) {
      fs.mkdirSync(testDbDir, { recursive: true });
    }
  });

  describe('CollectionPerTableStrategy Version Management', function() {
    let storage;
    const testDbFile = 'test-version-collection.db';
    const testDbPath = path.join(testDbDir, testDbFile);

    beforeEach(function(done) {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
      
      const adapter = new BetterSqliteAdapter(testDbPath, {debug: false});
      const schemaStrategy = new CollectionPerTableStrategy({
        collectionConfig: {
          'posts': { indexes: [], encryptedFields: [] }
        },
        debug: false
      });

      storage = new SqliteStorage({
        adapter: adapter,
        schemaStrategy: schemaStrategy,
        dbFileName: testDbFile,
        dbFileDir: testDbDir,
        debug: false
      });

      storage.initialize(done);
    });

    afterEach(function(done) {
      storage.close(done);
    });

    it('should support numeric versions', function(done) {
      const doc1 = {
        id: 'posts/post1',
        payload: { collection: 'posts', id: 'post1', title: 'v1', v: 1 }
      };

      storage.writeRecords({docs: [doc1]}, function(err) {
        expect(err).to.not.exist;
        
        // Update to version 2
        doc1.payload.v = 2;
        doc1.payload.title = 'v2';
        
        storage.writeRecords({docs: [doc1]}, function(err) {
          expect(err).to.not.exist;
          
          storage.readInventory(function(err, inv) {
            expect(err).to.not.exist;
            expect(inv.payload.collections.posts['posts/post1'].v).to.equal(2);
            done();
          });
        });
      });
    });

    it('should support string versions (timestamps)', function(done) {
      const doc1 = {
        id: 'posts/post1',
        payload: { 
          collection: 'posts', 
          id: 'post1', 
          title: 'timestamp1', 
          v: '20250826000000000000' 
        }
      };

      storage.writeRecords({docs: [doc1]}, function(err) {
        expect(err).to.not.exist;
        
        // Update to later timestamp
        doc1.payload.v = '20250827000000000000';
        doc1.payload.title = 'timestamp2';
        
        storage.writeRecords({docs: [doc1]}, function(err) {
          expect(err).to.not.exist;
          
          storage.readInventory(function(err, inv) {
            expect(err).to.not.exist;
            expect(inv.payload.collections.posts['posts/post1'].v).to.equal('20250827000000000000');
            done();
          });
        });
      });
    });

    it('should prevent version regression for numeric versions', function(done) {
      const doc1 = {
        id: 'posts/post1',
        payload: { collection: 'posts', id: 'post1', title: 'v3', v: 3 }
      };

      storage.writeRecords({docs: [doc1]}, function(err) {
        expect(err).to.not.exist;
        
        // Try to downgrade to version 2
        doc1.payload.v = 2;
        
        // Use updateInventory to test version checking
        storage.updateInventory('posts', 'posts/post1', 2, 'update', function(err) {
          expect(err).to.exist;
          expect(err.message).to.include('Version regression detected');
          expect(err.message).to.include('posts/posts/post1');
          expect(err.message).to.include('to version 2');
          expect(err.message).to.include('current version is 3');
          done();
        });
      });
    });

    it('should prevent version regression for string versions', function(done) {
      const doc1 = {
        id: 'posts/post1',
        payload: { 
          collection: 'posts', 
          id: 'post1', 
          title: 'later', 
          v: '20250827000000000000' 
        }
      };

      storage.writeRecords({docs: [doc1]}, function(err) {
        expect(err).to.not.exist;
        
        // Try to use earlier timestamp
        storage.updateInventory('posts', 'posts/post1', '20250826000000000000', 'update', function(err) {
          expect(err).to.exist;
          expect(err.message).to.include('Version regression detected');
          expect(err.message).to.include('posts/posts/post1');
          expect(err.message).to.include('to version 20250826000000000000');
          expect(err.message).to.include('current version is 20250827000000000000');
          done();
        });
      });
    });

    it('should prevent version type mismatch', function(done) {
      const doc1 = {
        id: 'posts/post1',
        payload: { collection: 'posts', id: 'post1', title: 'numeric', v: 5 }
      };

      storage.writeRecords({docs: [doc1]}, function(err) {
        expect(err).to.not.exist;
        
        // Try to switch to string version
        storage.updateInventory('posts', 'posts/post1', '20250827000000000000', 'update', function(err) {
          expect(err).to.exist;
          expect(err.message).to.include('Version type mismatch');
          expect(err.message).to.include('posts/posts/post1');
          expect(err.message).to.include('string version 20250827000000000000');
          done();
        });
      });
    });

    it('should handle documents with pending operations', function(done) {
      const doc1 = {
        id: 'posts/post1',
        payload: { 
          collection: 'posts', 
          id: 'post1', 
          title: 'with pending', 
          v: 1,
          pendingOps: [{ op: 'test' }]
        }
      };

      storage.writeRecords({docs: [doc1]}, function(err) {
        expect(err).to.not.exist;
        
        storage.readInventory(function(err, inv) {
          expect(err).to.not.exist;
          expect(inv.payload.collections.posts['posts/post1']).to.deep.equal({
            v: 1,
            p: true  // Has pending ops
          });
          
          // Update without pending ops
          doc1.payload.pendingOps = null;
          doc1.payload.v = 2;
          
          storage.writeRecords({docs: [doc1]}, function(err) {
            expect(err).to.not.exist;
            
            storage.readInventory(function(err, inv) {
              expect(err).to.not.exist;
              expect(inv.payload.collections.posts['posts/post1']).to.deep.equal({
                v: 2,
                p: false  // No pending ops
              });
              done();
            });
          });
        });
      });
    });
  });

  describe('DefaultSchemaStrategy with DurableStore-style inventory', function() {
    let storage;
    const testDbFile = 'test-version-default.db';
    const testDbPath = path.join(testDbDir, testDbFile);

    beforeEach(function(done) {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
      
      const adapter = new BetterSqliteAdapter(testDbPath, {debug: false});
      const schemaStrategy = new DefaultSchemaStrategy({debug: false});

      storage = new SqliteStorage({
        adapter: adapter,
        schemaStrategy: schemaStrategy,
        dbFileName: testDbFile,
        dbFileDir: testDbDir,
        debug: false
      });

      storage.initialize(done);
    });

    afterEach(function(done) {
      storage.close(done);
    });

    it('should store and retrieve versioned documents', function(done) {
      const doc1 = {
        id: 'posts/post1',
        payload: { collection: 'posts', id: 'post1', title: 'test', v: 1 }
      };

      storage.writeRecords({docs: [doc1]}, function(err) {
        expect(err).to.not.exist;
        
        storage.readRecord('docs', 'posts/post1', function(err, payload) {
          expect(err).to.not.exist;
          expect(payload).to.exist;
          expect(payload.v).to.equal(1);
          
          // Update version
          doc1.payload.v = 2;
          doc1.payload.title = 'updated';
          
          storage.writeRecords({docs: [doc1]}, function(err) {
            expect(err).to.not.exist;
            
            storage.readRecord('docs', 'posts/post1', function(err2, payload) {
              expect(err2).to.not.exist;
              expect(payload).to.exist;
              expect(payload.v).to.equal(2);
              expect(payload.title).to.equal('updated');
              done();
            });
          });
        });
      });
    });

  });
});