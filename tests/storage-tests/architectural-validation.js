const expect = require('chai').expect;
const SqliteStorage = require('..');
const DefaultSchemaStrategy = require('..').DefaultSchemaStrategy;
const CollectionPerTableStrategy = require('..').CollectionPerTableStrategy;
const BetterSqliteAdapter = require('@sharesync/sharedb-storage-node-sqlite');

describe('Architectural Validation - SQLite Storage', function() {

  describe('Interface Compliance', function() {
    let storage;
    let adapter;

    beforeEach(function() {
      adapter = new BetterSqliteAdapter(':memory:', { debug: false });
      storage = new SqliteStorage({
        adapter: adapter,
        dbFileName: ':memory:',
        debug: false
      });
    });

    afterEach(function(done) {
      if (storage) {
        storage.close(done);
      } else {
        done();
      }
    });

    it('should implement all required SqliteStorage methods', function() {
      const requiredMethods = [
        { name: 'initialize', minParams: 1 },
        { name: 'writeRecords', minParams: 2 },
        { name: 'readRecord', minParams: 3 },
        { name: 'readRecordsBulk', minParams: 3 },
        { name: 'deleteRecord', minParams: 3 },
        { name: 'readAllRecords', minParams: 3 },
        { name: 'updateInventory', minParams: 5 },
        { name: 'readInventory', minParams: 1 },
        { name: 'deleteDatabase', minParams: 1 },
        { name: 'close', minParams: 1 },
        { name: 'getStats', minParams: 1 }
      ];

      requiredMethods.forEach(function(methodSpec) {
        expect(typeof storage[methodSpec.name], 
          'Method ' + methodSpec.name + ' should exist').to.equal('function');
        expect(storage[methodSpec.name].length, 
          'Method ' + methodSpec.name + ' should have at least ' + methodSpec.minParams + ' parameters')
          .to.be.at.least(methodSpec.minParams);
      });
    });

    it('should implement all required schema strategy methods', function() {
      const defaultStrategy = new DefaultSchemaStrategy({ debug: false });
      const collectionStrategy = new CollectionPerTableStrategy({ debug: false });

      const requiredMethods = [
        'initializeSchema',
        'validateSchema', 
        'getTableName',
        'writeRecords',
        'readRecord',
        'readRecordsBulk',
        'deleteRecord',
        'initializeInventory',
        'readInventory',
        'updateInventoryItem',
        'deleteAllTables'
      ];

      [defaultStrategy, collectionStrategy].forEach(function(strategy, index) {
        const strategyName = index === 0 ? 'DefaultSchemaStrategy' : 'CollectionPerTableStrategy';
        
        requiredMethods.forEach(function(method) {
          expect(typeof strategy[method], 
            strategyName + ' method ' + method + ' should exist').to.equal('function');
        });
      });
    });
  });

  describe('Callback Convention Consistency', function() {
    let storage;
    let adapter;

    beforeEach(function(done) {
      adapter = new BetterSqliteAdapter(':memory:', { debug: false });
      storage = new SqliteStorage({
        adapter: adapter,
        dbFileName: ':memory:',
        debug: false
      });
      
      storage.initialize(done);
    });

    afterEach(function(done) {
      storage.close(done);
    });

    it('should use error-first callback convention consistently', function(done) {
      const testRecord = {
        id: 'callback-test-1',
        payload: { title: 'Callback Test', data: { test: true } }
      };

      let callbackCount = 0;
      const expectedCallbacks = 4;

      function checkCompletion() {
        callbackCount++;
        if (callbackCount === expectedCallbacks) {
          done();
        }
      }

      // Test writeRecords
      storage.writeRecords({ docs: [testRecord] }, function(error) {
        expect(arguments.length).to.equal(1, 'writeRecords callback should have 1 argument (error)');
        if (error) {
          expect(error).to.be.an('error');
        }
        checkCompletion();
      });

      // Test readRecord  
      storage.readRecord('docs', testRecord.id, function(error, result) {
        expect(arguments.length).to.equal(2, 'readRecord callback should have 2 arguments (error, result)');
        if (error) {
          expect(error).to.be.an('error');
          expect(result).to.be.undefined;
        }
        checkCompletion();
      });

      // Test readInventory
      storage.readInventory(function(error, inventory) {
        expect(arguments.length).to.equal(2, 'readInventory callback should have 2 arguments (error, result)');
        if (error) {
          expect(error).to.be.an('error');
          expect(inventory).to.be.undefined;
        }
        checkCompletion();
      });

      // Test updateInventory
      storage.updateInventory('testCollection', 'doc1', 1, 'add', function(error) {
        expect(arguments.length).to.equal(1, 'updateInventory callback should have 1 argument (error)');
        if (error) {
          expect(error).to.be.an('error');
        }
        checkCompletion();
      });
    });
  });

  describe('Promise Chain Stress Testing', function() {
    let storage;
    let adapter;

    beforeEach(function(done) {
      adapter = new BetterSqliteAdapter(':memory:', { debug: false });
      storage = new SqliteStorage({
        adapter: adapter,
        dbFileName: ':memory:',
        debug: false
      });
      
      storage.initialize(done);
    });

    afterEach(function(done) {
      storage.close(done);
    });

    it('should handle complex sequential operations without hanging', function(done) {
      this.timeout(5000);
      
      const operationCount = 15;
      const testRecords = [];
      
      // Create test records
      for (let i = 0; i < operationCount; i++) {
        testRecords.push({
          id: 'stress-' + i,
          payload: { 
            title: 'Stress Test ' + i, 
            data: { index: i, timestamp: Date.now() }
          }
        });
      }

      let completedOps = 0;

      function processRecord(record, callback) {
        // Write record
        storage.writeRecords({ docs: [record] }, function(writeError) {
          if (writeError) return callback(writeError);
          
          // Read record back
          storage.readRecord('docs', record.id, function(readError, result) {
            if (readError) return callback(readError);
            
            expect(result).to.exist;
            expect(result.title).to.equal(record.payload.title);
            
            // Update inventory
            storage.updateInventory('stressCollection', record.id, 1, 'add', function(invError) {
              if (invError) return callback(invError);
              
              completedOps++;
              callback(null);
            });
          });
        });
      }

      // Process records sequentially to test chaining
      let recordIndex = 0;
      function processNext() {
        if (recordIndex >= testRecords.length) {
          expect(completedOps).to.equal(operationCount);
          return done();
        }
        
        processRecord(testRecords[recordIndex++], function(error) {
          if (error) return done(error);
          processNext();
        });
      }

      processNext();
    });

    it('should handle bulk operations with large datasets', function(done) {
      this.timeout(10000);
      
      const bulkSize = 25;
      const bulkRecords = [];
      
      for (let i = 0; i < bulkSize; i++) {
        bulkRecords.push({
          id: 'bulk-' + i,
          payload: { 
            title: 'Bulk Record ' + i,
            data: { 
              index: i, 
              category: i % 5,
              tags: ['tag1', 'tag2', 'tag' + (i % 3)]
            }
          }
        });
      }

      // Write all records in bulk
      storage.writeRecords({ docs: bulkRecords }, function(writeError) {
        expect(writeError).to.not.exist;
        
        // Read them back in bulk
        const ids = bulkRecords.map(r => r.id);
        storage.readRecordsBulk('docs', ids, function(readError, results) {
          expect(readError).to.not.exist;
          expect(results).to.be.an('array');
          expect(results.length).to.equal(bulkSize);
          
          // Verify data integrity
          const resultIds = results.map(r => r.id);
          ids.forEach(id => {
            expect(resultIds).to.include(id);
          });
          
          done();
        });
      });
    });
  });

  describe('Context Preservation and Async Handling', function() {
    it('should preserve context through schema strategy async operations', function(done) {
      const strategy = new DefaultSchemaStrategy({ 
        debug: false,
        testProperty: 'context-test-value'
      });
      
      const adapter = new BetterSqliteAdapter(':memory:', { debug: false });
      const storage = new SqliteStorage({
        adapter: adapter,
        schemaStrategy: strategy,
        dbFileName: ':memory:',
        debug: false
      });

      // Mock the schema strategy to verify context preservation
      const originalWriteRecords = strategy.writeRecords;
      strategy.writeRecords = function(db, recordsByType, callback) {
        const self = this;
        
        // Simulate async operation
        setTimeout(function() {
          expect(self.testProperty).to.equal('context-test-value', 
            'Context should be preserved in async schema operations');
          
          originalWriteRecords.call(self, db, recordsByType, callback);
        }, 10);
      };

      storage.initialize(function(err) {
        expect(err).to.be.null;
        expect(initError).to.not.exist;
        
        const testRecord = {
          id: 'context-test',
          payload: { title: 'Context Test' }
        };
        
        storage.writeRecords({ docs: [testRecord] }, function(writeError) {
          expect(writeError).to.not.exist;
          storage.close(done);
        });
      });
    });

    it('should handle promise chains in db wrapper correctly', function(done) {
      const adapter = new BetterSqliteAdapter(':memory:', { debug: false });
      const storage = new SqliteStorage({
        adapter: adapter,
        dbFileName: ':memory:',
        debug: false
      });

      storage.initialize(function(err) {
        expect(err).to.be.null;
        expect(initError).to.not.exist;
        
        // Test the db wrapper's promise chaining by doing nested operations
        const dbWrapper = storage._createDbWrapper();
        
        dbWrapper.runAsync(
          'CREATE TABLE test_chain (id TEXT PRIMARY KEY, data TEXT)', []
        ).then(function() {
          return dbWrapper.runAsync(
            'INSERT INTO test_chain (id, data) VALUES (?, ?)', 
            ['test1', 'chain-test']
          );
        }).then(function() {
          return dbWrapper.getFirstAsync(
            'SELECT data FROM test_chain WHERE id = ?', 
            ['test1']
          );
        }).then(function(row) {
          expect(row).to.exist;
          expect(row.data).to.equal('chain-test');
          storage.close(done);
        }).catch(function(error) {
          storage.close(function() {
            done(error);
          });
        });
      });
    });
  });

  describe('Method Name Collision Detection', function() {
    it('should not have unexpected method collisions in schema strategies', function() {
      const defaultStrategy = new DefaultSchemaStrategy({ debug: false });
      const collectionStrategy = new CollectionPerTableStrategy({ debug: false });

      // Test that both strategies implement the required interface methods
      const interfaceMethods = [
        'getTableName',
        'initializeSchema', 
        'writeRecords',
        'readRecord'
      ];
      
      interfaceMethods.forEach(function(method) {
        expect(typeof defaultStrategy[method]).to.equal('function',
          'DefaultSchemaStrategy should implement ' + method);
        expect(typeof collectionStrategy[method]).to.equal('function',
          'CollectionPerTableStrategy should implement ' + method);
      });

      // Verify they return different results for different collections (indicating proper implementation)
      expect(defaultStrategy.getTableName('test')).to.not.equal(
        collectionStrategy.getTableName('test'),
        'Different strategies should handle table names differently'
      );
    });

    it('should sanitize collection names properly', function() {
      const strategy = new CollectionPerTableStrategy({ debug: false });
      
      // Test various potentially problematic collection names
      const testNames = [
        { input: 'normal-collection', expected: /^[a-zA-Z0-9_]+$/ },
        { input: 'test.with.dots', expected: /^[a-zA-Z0-9_]+$/ },
        { input: 'test with spaces', expected: /^[a-zA-Z0-9_]+$/ },
        { input: 'test-with-dashes', expected: /^[a-zA-Z0-9_]+$/ }
      ];
      
      testNames.forEach(function(test) {
        const tableName = strategy.getTableName(test.input);
        expect(tableName).to.match(test.expected,
          'Table name should be sanitized: ' + tableName + ' from input: ' + test.input);
      });
    });
  });

  describe('Schema Strategy Namespace Collision Prevention', function() {
    it('should prevent user collections from colliding with system tables', function(done) {
      const adapter = new BetterSqliteAdapter(':memory:', { debug: false });
      const strategy = new CollectionPerTableStrategy({
        collectionConfig: {
          'meta': { indexes: [], encryptedFields: [] },
          'inventory': { indexes: [], encryptedFields: [] }
        },
        debug: false
      });

      const storage = new SqliteStorage({
        adapter: adapter,
        schemaStrategy: strategy,
        dbFileName: ':memory:',
        debug: false
      });

      storage.initialize(function(err) {
        expect(err).to.be.null;
        expect(initError).to.not.exist;
        
        // Verify that user collections named 'meta' and 'inventory' 
        // get different table names than system tables
        expect(strategy.getTableName('meta')).to.not.equal('sharedb_meta');
        expect(strategy.getTableName('inventory')).to.not.equal('sharedb_inventory');
        expect(strategy.getTableName('__meta__')).to.equal('sharedb_meta');
        
        // Test writing to user collections with potentially conflicting names
        const testRecords = [
          { 
            id: 'user_meta_1',
            collection: 'meta',
            payload: { type: 'user_metadata', value: 'test' }
          },
          {
            id: 'user_inv_1', 
            collection: 'inventory',
            payload: { item: 'widget', count: 5 }
          }
        ];

        storage.writeRecords({ docs: testRecords }, function(writeError) {
          expect(writeError).to.not.exist;
          
          // Should be able to read them back without collision
          storage.readRecord('docs', 'user_meta_1', function(readError1, result1) {
            expect(readError1).to.not.exist;
            expect(result1).to.exist;
            expect(result1.type).to.equal('user_metadata');
            
            storage.readRecord('docs', 'user_inv_1', function(readError2, result2) {
              expect(readError2).to.not.exist;  
              expect(result2).to.exist;
              expect(result2.item).to.equal('widget');
              
              // System inventory should still work
              storage.readInventory(function(invError, systemInventory) {
                expect(invError).to.not.exist;
                expect(systemInventory).to.exist;
                
                storage.close(done);
              });
            });
          });
        });
      });
    });
  });

  describe('Edge Case and Error Resilience', function() {
    let storage;
    let adapter;

    beforeEach(function(done) {
      adapter = new BetterSqliteAdapter(':memory:', { debug: false });
      storage = new SqliteStorage({
        adapter: adapter,
        dbFileName: ':memory:',
        debug: false
      });
      
      storage.initialize(done);
    });

    afterEach(function(done) {
      storage.close(done);
    });

    it('should handle malformed record data gracefully', function(done) {
      const malformedRecords = [
        { id: null, payload: { valid: true } },
        { id: 'test1', payload: null },
        { id: '', payload: { empty: 'id' } },
        { id: 'valid-id' /* missing payload */ }
      ];

      let processedCount = 0;
      const expectedCount = malformedRecords.length;

      malformedRecords.forEach(function(record) {
        storage.writeRecords({ docs: [record] }, function(error) {
          // Should either succeed with cleanup or fail gracefully without hanging
          processedCount++;
          if (processedCount === expectedCount) {
            done(); // All processed without system failure
          }
        });
      });
    });

    it('should handle empty and null inputs gracefully', function(done) {
      let testCount = 0;
      const expectedTests = 4;

      function checkCompletion() {
        testCount++;
        if (testCount === expectedTests) {
          done();
        }
      }

      // Test empty writeRecords
      storage.writeRecords({}, function(error1) {
        // Should not error on empty records
        checkCompletion();
      });

      // Test empty docs array
      storage.writeRecords({ docs: [] }, function(error2) {
        // Should not error on empty array
        checkCompletion();
      });

      // Test readRecordsBulk with empty array
      storage.readRecordsBulk('docs', [], function(error3, results) {
        expect(error3).to.not.exist;
        expect(results).to.be.an('array');
        expect(results.length).to.equal(0);
        checkCompletion();
      });

      // Test reading non-existent record
      storage.readRecord('docs', 'nonexistent', function(error4, result) {
        expect(error4).to.not.exist;
        expect(result).to.not.exist;
        checkCompletion();
      });
    });

    it('should maintain data consistency under concurrent operations', function(done) {
      this.timeout(3000);
      
      const concurrentOps = 8;
      let completedOps = 0;
      const errors = [];

      // Launch multiple concurrent operations
      for (let i = 0; i < concurrentOps; i++) {
        const record = {
          id: 'concurrent-' + i,
          payload: { 
            thread: i, 
            timestamp: Date.now(),
            data: 'concurrent-test-data-' + i
          }
        };

        storage.writeRecords({ docs: [record] }, function(writeError) {
          if (writeError) {
            errors.push(writeError);
          }
          
          storage.readRecord('docs', record.id, function(readError, result) {
            if (readError) {
              errors.push(readError);
            } else if (result) {
              expect(result.thread).to.equal(i);
            }
            
            completedOps++;
            if (completedOps === concurrentOps) {
              expect(errors.length).to.equal(0, 'Should handle concurrent access without errors: ' + 
                errors.map(e => e.message).join(', '));
              done();
            }
          });
        });
      }
    });
  });
});