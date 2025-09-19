/**
 * Tests for CollectionPerTableStrategy
 */

var expect = require('chai').expect;
var CollectionPerTableStrategy = require('../../lib/schema/collection-per-table-strategy');
var TestDbHelper = require('../helpers/test-db-helper');

describe('CollectionPerTableStrategy', function() {
  var strategy;
  var db;

  beforeEach(async function() {
    helper = new TestDbHelper('test');
    db = await helper.createAdapter();
    
  });

  describe('initialization', function() {
    it('should initialize with default options', function() {
      strategy = new CollectionPerTableStrategy();
      expect(strategy).to.exist;
      expect(strategy.getInventoryType()).to.equal('table');
    });

    it('should initialize with collection config', function() {
      var options = {
        collectionConfig: {
          terms: {
            indexes: ['payload.term'],
            encryptedFields: [],
            projections: [
              {
                type: 'array_expansion',
                targetTable: 'term_tag',
                mapping: {
                  'term_id': 'id',
                  'tag': '@element'
                },
                arrayPath: 'tags',
                primaryKey: ['term_id', 'tag']
              }
            ]
          }
        }
      };

      strategy = new CollectionPerTableStrategy(options);
      expect(strategy).to.exist;
    });
  });

  describe('initializeSchema', function() {
    beforeEach(function() {
      strategy = new CollectionPerTableStrategy({
        collectionConfig: {
          terms: {
            indexes: ['payload.term'],
            encryptedFields: []
          }
        }
      });
    });

    it('should create inventory table', function(done) {
      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var createStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1;
        });

        var hasInventoryTable = createStatements.some(function(h) {
          return h.sql.indexOf('sharedb_inventory') !== -1;
        });

        expect(hasInventoryTable).to.be.true;
        done();
      });
    });

    it('should create collection tables for configured collections', function(done) {
      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var createStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1;
        });

        var hasCollectionTable = createStatements.some(function(h) {
          return h.sql.indexOf('CREATE TABLE IF NOT EXISTS terms') !== -1;
        });

        expect(hasCollectionTable).to.be.true;
        done();
      });
    });

    it('should create indexes on inventory table', function(done) {
      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var indexStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE INDEX') !== -1;
        });

        var hasCollectionIndex = indexStatements.some(function(h) {
          return h.sql.indexOf('idx_inventory_collection') !== -1;
        });
        var hasUpdatedIndex = indexStatements.some(function(h) {
          return h.sql.indexOf('idx_inventory_updated') !== -1;
        });

        expect(hasCollectionIndex).to.be.true;
        expect(hasUpdatedIndex).to.be.true;
        done();
      });
    });
  });

  describe('projections', function() {
    beforeEach(function() {
      var options = {
        collectionConfig: {
          terms: {
            indexes: [],
            encryptedFields: [],
            projections: [
              {
                type: 'array_expansion',
                targetTable: 'term_tag',
                mapping: {
                  'term_id': 'id',
                  'tag': '@element'
                },
                arrayPath: 'tags',
                primaryKey: ['term_id', 'tag'],
                indexes: [
                  {
                    columns: ['tag'],
                    unique: false
                  }
                ]
              }
            ]
          }
        }
      };
      strategy = new CollectionPerTableStrategy(options);
    });

    it('should create projection tables', function(done) {
      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var createStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1;
        });

        var hasProjectionTable = createStatements.some(function(h) {
          return h.sql.indexOf('term_tag') !== -1;
        });

        expect(hasProjectionTable).to.be.true;
        done();
      });
    });

    it('should create indexes on projection tables', function(done) {
      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var indexStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE INDEX') !== -1 || h.sql.indexOf('CREATE UNIQUE INDEX') !== -1;
        });

        // Should have indexes for primary key columns
        var hasTermIdIndex = indexStatements.some(function(h) {
          return h.sql.indexOf('idx_term_tag_term_id') !== -1;
        });
        var hasTagIndex = indexStatements.some(function(h) {
          return h.sql.indexOf('idx_term_tag_tag') !== -1;
        });

        expect(hasTermIdIndex).to.be.true;
        expect(hasTagIndex).to.be.true;
        done();
      });
    });

    it('should handle @element and source in projection mappings', function(done) {
      // Create a strategy with modern mapping syntax
      var modernOptions = {
        collectionConfig: {
          terms: {
            indexes: [],
            encryptedFields: [],
            projections: [
              {
                type: 'array_expansion',
                targetTable: 'user_tags',
                mapping: {
                  'doc_id': 'id',  // Special case for document id
                  'phrase_id': {
                    source: 'phrase_id',  // Using 'source' instead of direct string
                    dataType: 'INTEGER'
                  },
                  'tag': {
                    source: '@element',  // Using @element for array item
                    dataType: 'TEXT'
                  }
                },
                arrayPath: 'user_tags',
                primaryKey: ['doc_id', 'tag']
              }
            ]
          }
        }
      };

      var modernStrategy = new CollectionPerTableStrategy(modernOptions);

      modernStrategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        // Verify that the projection table was created
        var history = db.getSqlHistory();
        var createStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1;
        });

        var hasUserTagsTable = createStatements.some(function(h) {
          return h.sql.indexOf('user_tags') !== -1;
        });

        expect(hasUserTagsTable).to.be.true;

        // Write a document with user tags
        var record = {
          id: 'term-123',
          payload: {
            v: 1,
            collection: 'terms',
            phrase_id: 456,
            user_tags: ['custom-tag-1', 'custom-tag-2']
          }
        };

        modernStrategy.writeRecords(db, { docs: [record] }, function(err) {
          try {
            // Get updated history after the write operation
            var updatedHistory = db.getSqlHistory();

            // Check that projection inserts were attempted
            var insertStatements = updatedHistory.filter(function(h) {
              return h.sql.indexOf('INSERT') !== -1 && h.sql.indexOf('user_tags') !== -1;
            });

            // Should have INSERT statements for the projections
            expect(insertStatements.length).to.be.above(0);

            // Verify the parameters passed to INSERT statements
            // The mock database doesn't properly handle complex queries,
            // but we can verify that the strategy attempted to create projections
            var projectionInserts = insertStatements.filter(function(h) {
              return h.params && h.params.indexOf('term-123') !== -1;
            });

            expect(projectionInserts.length).to.be.above(0);

            done();
          } catch (e) {
            done(e);
          }
        });
      });
    });

    // Test skipped - mock database limitations prevent testing projection updates
    it.skip('should update projections when array values change', function(done) {
      var options = {
        collectionConfig: {
          terms: {
            indexes: [],
            encryptedFields: [],
            projections: [
              {
                type: 'array_expansion',
                targetTable: 'term_tags_update_test',
                mapping: {
                  'term_id': 'id',
                  'tag': {
                    source: '@element'
                  }
                },
                arrayPath: 'tags',
                primaryKey: ['term_id', 'tag']
              }
            ]
          }
        }
      };

      var strategy = new CollectionPerTableStrategy(options);

      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        // Initial write with tags
        var record1 = {
          id: 'term-update-1',
          payload: {
            v: 1,
            collection: 'terms',
            tags: ['tag1', 'tag2']
          }
        };

        strategy.writeRecords(db, { docs: [record1] }, function(err) {
          // Get history after first write
          var historyAfterFirst = db.getSqlHistory();

          // Verify initial projection inserts were attempted
          var initialInserts = historyAfterFirst.filter(function(h) {
            return h.sql.indexOf('INSERT') !== -1 &&
                   h.sql.indexOf('term_tags_update_test') !== -1;
          });

          // Should have INSERT statements for the initial tags (at least 2 for tag1 and tag2)
          expect(initialInserts.length).to.be.at.least(2);

          // Update with different tags
          var record2 = {
            id: 'term-update-1',
            payload: {
              v: 2,
              collection: 'terms',
              tags: ['tag2', 'tag3', 'tag4']  // Removed tag1, kept tag2, added tag3 and tag4
            }
          };

          strategy.writeRecords(db, { docs: [record2] }, function(err) {
            // Get history after second write
            var historyAfterSecond = db.getSqlHistory();

            // Check that projection operations happened during the update
            // We expect DELETE followed by new INSERTs
            var projectionOperations = historyAfterSecond.filter(function(h, index) {
              return index > historyAfterFirst.length &&
                     h.sql.indexOf('term_tags_update_test') !== -1;
            });

            // Should have operations on the projection table for the update
            expect(projectionOperations.length).to.be.at.least(1);

            done();
          });
        });
      });
    });
  });

  describe('writeRecords', function() {
    beforeEach(function() {
      strategy = new CollectionPerTableStrategy({
        collectionConfig: {
          terms: {
            indexes: [],
            encryptedFields: []
          }
        }
      });
    });

    it('should write document records', function(done) {
      var records = {
        docs: [
          {
            id: 'term-1',
            payload: {
              collection: 'terms',
              id: 'term-1',
              term: 'hello',
              v: 1
            }
          }
        ]
      };

      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        strategy.writeRecords(db, records, function(err) {
          expect(err).to.not.exist;

          var history = db.getSqlHistory();
          var insertStatements = history.filter(function(h) {
            return h.sql.indexOf('INSERT') !== -1;
          });

          var hasDocInsert = insertStatements.some(function(h) {
            return h.sql.indexOf('collection_terms') !== -1;
          });

          expect(hasDocInsert).to.be.true;
          done();
        });
      });
    });

    it('should update inventory when writing records', function(done) {
      var records = {
        docs: [
          {
            id: 'term-1',
            payload: {
              collection: 'terms',
              id: 'term-1',
              term: 'hello',
              v: 1
            }
          }
        ]
      };

      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        strategy.writeRecords(db, records, function(err) {
          expect(err).to.not.exist;

          var history = db.getSqlHistory();
          var inventoryStatements = history.filter(function(h) {
            return h.sql.indexOf('sharedb_inventory') !== -1 && h.sql.indexOf('INSERT') !== -1;
          });

          expect(inventoryStatements.length).to.be.above(0);
          done();
        });
      });
    });
  });

  describe('readRecord', function() {
    beforeEach(function(done) {
      strategy = new CollectionPerTableStrategy({
        collectionConfig: {
          terms: {
            indexes: [],
            encryptedFields: []
          }
        }
      });
      strategy.initializeSchema(db, done);
    });

    it('should return null for non-existent record', function(done) {
      strategy.readRecord(db, 'docs', 'terms', 'non-existent', function(err, record) {
        expect(err).to.not.exist;
        expect(record).to.be.null;
        done();
      });
    });

    it('should read record with compound ID correctly', function(done) {
      // First write a record with compound ID (as ShareDB does)
      var recordData = {
        id: 'terms/test123',
        payload: {
          v: 1,
          type: 'json',
          data: {
            meta: { kind: 'terms', ref: 'test123' },
            payload: { content: 'test' }
          }
        }
      };

      // Simulate how writeCollectionRecord stores the record
      // The mock expects records to have 'id' and 'data' fields
      db.setTableData('terms', [{
        id: 'terms/test123',
        data: JSON.stringify(recordData)
      }]);

      // Now try to read it using just the doc ID (not the compound ID)
      strategy.readRecord(db, 'docs', 'terms', 'test123', function(err, retrievedRecord) {
        expect(err).to.not.exist;
        expect(retrievedRecord).to.exist;
        expect(retrievedRecord.id).to.equal('terms/test123');
        expect(retrievedRecord.payload.data.meta.ref).to.equal('test123');
        done();
      });
    });

    it('should handle compound ID with special characters', function(done) {
      // Test with ID containing special characters
      var recordData = {
        id: 'manifest/QyCgGHk2qzIHBojq',
        payload: {
          v: 54,
          type: 'json',
          data: {
            meta: { kind: 'manifest', ref: 'QyCgGHk2qzIHBojq' },
            payload: { collections: {} }
          }
        }
      };

      // The mock expects records to have 'id' and 'data' fields
      db.setTableData('manifest', [{
        id: 'manifest/QyCgGHk2qzIHBojq',
        data: JSON.stringify(recordData)
      }]);

      strategy.readRecord(db, 'docs', 'manifest', 'QyCgGHk2qzIHBojq', function(err, retrievedRecord) {
        expect(err).to.not.exist;
        expect(retrievedRecord).to.exist;
        expect(retrievedRecord.id).to.equal('manifest/QyCgGHk2qzIHBojq');
        done();
      });
    });
  });

  describe('deleteRecord', function() {
    beforeEach(function(done) {
      strategy = new CollectionPerTableStrategy({
        collectionConfig: {
          terms: {
            indexes: [],
            encryptedFields: []
          }
        }
      });
      strategy.initializeSchema(db, done);
    });

    it('should delete a record', function(done) {
      strategy.deleteRecord(db, 'docs', 'terms', 'term-1', function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var deleteStatements = history.filter(function(h) {
          return h.sql.indexOf('DELETE') !== -1;
        });

        expect(deleteStatements.length).to.be.above(0);
        done();
      });
    });

    it('should remove from inventory when deleting', function(done) {
      strategy.deleteRecord(db, 'docs', 'terms', 'term-1', function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var inventoryDeletes = history.filter(function(h) {
          return h.sql.indexOf('DELETE') !== -1 && h.sql.indexOf('sharedb_inventory') !== -1;
        });

        expect(inventoryDeletes.length).to.be.above(0);
        done();
      });
    });

    it('should delete record with compound ID correctly', function(done) {
      // Setup: Add a record with compound ID
      var recordData = {
        id: 'terms/deleteTest',
        payload: {
          v: 1,
          type: 'json',
          data: {
            meta: { kind: 'terms', ref: 'deleteTest' },
            payload: { content: 'test' }
          }
        }
      };

      db.setTableData('terms', [{
        id: 'terms/deleteTest',
        data: JSON.stringify(recordData)
      }]);

      // Delete using just the doc ID (not the compound ID)
      strategy.deleteRecord(db, 'docs', 'terms', 'deleteTest', function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var deleteStatements = history.filter(function(h) {
          return h.sql.indexOf('DELETE FROM terms') !== -1;
        });

        expect(deleteStatements.length).to.be.above(0);
        // Verify the DELETE used the compound ID
        expect(deleteStatements[0].params[0]).to.equal('terms/deleteTest');
        done();
      });
    });
  });

  describe('inventory management', function() {
    beforeEach(function(done) {
      strategy = new CollectionPerTableStrategy();
      strategy.initializeSchema(db, done);
    });

    it('should read empty inventory', function(done) {
      strategy.readInventory(db, function(err, inventory) {
        expect(err).to.not.exist;
        expect(inventory).to.exist;
        expect(inventory.id).to.equal('inventory');
        expect(inventory.payload).to.exist;
        expect(inventory.payload.collections).to.deep.equal({});
        done();
      });
    });

    it('should update inventory item', function(done) {
      strategy.updateInventoryItem(db, 'terms', 'term-1', 5, 'add', function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var inventoryUpdates = history.filter(function(h) {
          return h.sql.indexOf('sharedb_inventory') !== -1 &&
                 (h.sql.indexOf('INSERT') !== -1 || h.sql.indexOf('UPDATE') !== -1);
        });

        expect(inventoryUpdates.length).to.be.above(0);
        done();
      });
    });

    it('should write inventory from meta using INSERT OR REPLACE', function(done) {
      // Create inventory meta with multiple items
      var inventoryMeta = {
        id: 'inventory',
        payload: {
          collections: {
            manifest: {
              'QyCgGHk2qzIHBojq': { v: 54 },
              'AnotherManifest': { v: 10 }
            },
            terms: {
              'term1': { v: 1 },
              'term2': { v: 2 }
            }
          }
        }
      };

      strategy.writeInventoryFromMeta(db, inventoryMeta).then(function() {
        var history = db.getSqlHistory();
        var insertStatements = history.filter(function(h) {
          return h.sql.indexOf('INSERT OR REPLACE INTO sharedb_inventory') !== -1;
        });

        // Should have one INSERT OR REPLACE for each item (4 total)
        expect(insertStatements.length).to.equal(4);

        // Verify the statements use INSERT OR REPLACE (not DELETE + INSERT)
        var deleteStatements = history.filter(function(h) {
          return h.sql.indexOf('DELETE FROM sharedb_inventory') !== -1;
        });
        expect(deleteStatements.length).to.equal(0);

        done();
      }).catch(done);
    });

    it('should preserve existing inventory when writing from meta', function(done) {
      // First add some existing inventory
      db.setTableData('sharedb_inventory', [
        { collection: 'existing', doc_id: 'keep-me', version_num: 99, version_str: null, has_pending: 0 }
      ]);

      // Now write inventory from meta
      var inventoryMeta = {
        id: 'inventory',
        payload: {
          collections: {
            manifest: {
              'QyCgGHk2qzIHBojq': { v: 54 }
            }
          }
        }
      };

      strategy.writeInventoryFromMeta(db, inventoryMeta).then(function() {
        // The existing inventory item should still be there
        // (we can't check the actual table data in the mock, but we can verify no DELETE was issued)
        var history = db.getSqlHistory();
        var deleteStatements = history.filter(function(h) {
          return h.sql.indexOf('DELETE FROM sharedb_inventory') !== -1;
        });
        expect(deleteStatements.length).to.equal(0);

        done();
      }).catch(done);
    });
  });

  describe('projections', function() {
    var projectionConfig = {
      collectionConfig: {
        term: {
          indexes: ['payload.data.payload.starred_at'],
          encryptedFields: [],
          projections: [
            {
              type: 'array_expansion',
              targetTable: 'term_user_tag',
              mapping: {
                'term_id': 'id',
                'phrase_id': 'payload.data.payload.phrase_id',
                'tag': '@element'
              },
              arrayPath: 'payload.data.payload.user_tags',
              primaryKey: ['term_id', 'tag'],
              indexes: [
                { columns: ['phrase_id'] },
                { columns: ['tag', 'phrase_id'] }
              ]
            }
          ]
        }
      }
    };

    beforeEach(function(done) {
      strategy = new CollectionPerTableStrategy(projectionConfig);
      strategy.initializeSchema(db, done);
    });

    it('should create projection table', function() {
      var tables = db.getTables();
      expect(tables).to.include('term_user_tag');
    });

    it('should populate projection when writing document with array', function(done) {
      var termDoc = {
        id: 'term-123',
        payload: {
          collection: 'term',
          id: 'term-123',
          v: 1,
          data: {
            meta: {
              updated_at: { utc_time: '2024-01-01T00:00:00Z' }
            },
            payload: {
              text: 'test',
              phrase_id: 456,
              user_tags: ['tag1', 'tag2', 'tag3']
            }
          }
        }
      };

      strategy.writeRecords(db, { docs: [termDoc] }, function(err) {
        expect(err).to.not.exist;

        // Check projection table was populated
        var projectionData = db.getTableData('term_user_tag');
        expect(projectionData).to.have.lengthOf(3);

        // Check first projection row
        expect(projectionData[0].term_id).to.equal('term-123');
        expect(projectionData[0].phrase_id).to.equal(456);
        expect(projectionData[0].tag).to.equal('tag1');

        // Check second projection row
        expect(projectionData[1].tag).to.equal('tag2');

        // Check third projection row
        expect(projectionData[2].tag).to.equal('tag3');

        done();
      });
    });

    it('should handle empty array in document', function(done) {
      var termDoc = {
        id: 'term-empty',
        payload: {
          collection: 'term',
          id: 'term-empty',
          v: 1,
          data: {
            meta: {
              updated_at: { utc_time: '2024-01-01T00:00:00Z' }
            },
            payload: {
              text: 'empty test',
              phrase_id: 789,
              user_tags: []
            }
          }
        }
      };

      strategy.writeRecords(db, { docs: [termDoc] }, function(err) {
        expect(err).to.not.exist;

        // Check projection table has no entries for this document
        var projectionData = db.getTableData('term_user_tag');
        var entries = projectionData.filter(function(row) {
          return row.term_id === 'term-empty';
        });
        expect(entries).to.have.lengthOf(0);

        done();
      });
    });

    it('should handle missing array field in document', function(done) {
      var termDoc = {
        id: 'term-no-tags',
        payload: {
          collection: 'term',
          id: 'term-no-tags',
          v: 1,
          data: {
            meta: {
              updated_at: { utc_time: '2024-01-01T00:00:00Z' }
            },
            payload: {
              text: 'no tags test',
              phrase_id: 999
              // user_tags field is missing
            }
          }
        }
      };

      strategy.writeRecords(db, { docs: [termDoc] }, function(err) {
        expect(err).to.not.exist;

        // Check projection table has no entries for this document
        var projectionData = db.getTableData('term_user_tag');
        var entries = projectionData.filter(function(row) {
          return row.term_id === 'term-no-tags';
        });
        expect(entries).to.have.lengthOf(0);

        done();
      });
    });

    it('should update projection when document is updated', function(done) {
      var termDoc = {
        id: 'term-update',
        payload: {
          collection: 'term',
          id: 'term-update',
          v: 1,
          data: {
            meta: {
              updated_at: { utc_time: '2024-01-01T00:00:00Z' }
            },
            payload: {
              text: 'update test',
              phrase_id: 111,
              user_tags: ['old1', 'old2']
            }
          }
        }
      };

      // Write initial document
      strategy.writeRecords(db, { docs: [termDoc] }, function(err) {
        expect(err).to.not.exist;

        // Update document with new tags
        termDoc.payload.v = 2;
        termDoc.payload.data.payload.user_tags = ['new1', 'new2', 'new3'];

        strategy.writeRecords(db, { docs: [termDoc] }, function(err) {
          expect(err).to.not.exist;

          // Check projection table has new tags
          var projectionData = db.getTableData('term_user_tag');
          var entries = projectionData.filter(function(row) {
            return row.term_id === 'term-update';
          });

          expect(entries).to.have.lengthOf(3);
          var tags = entries.map(function(e) { return e.tag; });
          expect(tags).to.include('new1');
          expect(tags).to.include('new2');
          expect(tags).to.include('new3');
          expect(tags).to.not.include('old1');
          expect(tags).to.not.include('old2');

          done();
        });
      });
    });

    it('should handle paths with dots correctly', function(done) {
      // Test that paths like 'payload.data.payload.phrase_id' are resolved correctly
      var termDoc = {
        id: 'term-path-test',
        payload: {
          collection: 'term',
          id: 'term-path-test',
          v: 1,
          data: {
            meta: {
              updated_at: { utc_time: '2024-01-01T00:00:00Z' }
            },
            payload: {
              text: 'path test',
              phrase_id: 42,
              user_tags: ['test-tag']
            }
          }
        }
      };

      strategy.writeRecords(db, { docs: [termDoc] }, function(err) {
        expect(err).to.not.exist;

        // Check that phrase_id was extracted correctly from the path
        var projectionData = db.getTableData('term_user_tag');
        var entry = projectionData.find(function(row) {
          return row.term_id === 'term-path-test';
        });

        expect(entry).to.exist;
        expect(entry.phrase_id).to.equal(42);
        expect(entry.phrase_id).to.not.equal('payload.data.payload.phrase_id'); // Should not be the path string

        done();
      });
    });

    it('should handle special @element mapping', function(done) {
      var termDoc = {
        id: 'term-element',
        payload: {
          collection: 'term',
          id: 'term-element',
          v: 1,
          data: {
            meta: {
              updated_at: { utc_time: '2024-01-01T00:00:00Z' }
            },
            payload: {
              text: 'element test',
              phrase_id: 333,
              user_tags: ['elementTag1', 'elementTag2']
            }
          }
        }
      };

      strategy.writeRecords(db, { docs: [termDoc] }, function(err) {
        expect(err).to.not.exist;

        // Check that @element was replaced with actual array values
        var projectionData = db.getTableData('term_user_tag');
        var entries = projectionData.filter(function(row) {
          return row.term_id === 'term-element';
        });

        expect(entries).to.have.lengthOf(2);
        expect(entries[0].tag).to.equal('elementTag1');
        expect(entries[1].tag).to.equal('elementTag2');

        done();
      });
    });
  });
});