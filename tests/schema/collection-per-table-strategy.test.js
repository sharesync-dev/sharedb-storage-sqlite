/**
 * Tests for CollectionPerTableStrategy
 */

var expect = require('chai').expect;
var CollectionPerTableStrategy = require('../../lib/schema/collection-per-table-strategy');
var MockDatabase = require('../mocks/mock-database');

describe('CollectionPerTableStrategy', function() {
  var strategy;
  var db;

  beforeEach(function() {
    db = new MockDatabase();
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
                  'term_id': '$.id',
                  'tag': '$.ARRAY_ITEM'
                },
                arrayPath: 'payload.tags',
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

    it('should create meta and inventory tables', function(done) {
      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var createStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1;
        });

        var hasMetaTable = createStatements.some(function(h) {
          return h.sql.indexOf('sharedb_meta') !== -1;
        });
        var hasInventoryTable = createStatements.some(function(h) {
          return h.sql.indexOf('sharedb_inventory') !== -1;
        });

        expect(hasMetaTable).to.be.true;
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
          return h.sql.indexOf('collection_terms') !== -1;
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
                  'term_id': '$.id',
                  'tag': '$.ARRAY_ITEM'
                },
                arrayPath: 'payload.tags',
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
          return h.sql.indexOf('projection_term_tag') !== -1;
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

    it('should read meta records', function(done) {
      // First write a meta record
      db.setTableData('sharedb_meta', [
        { id: 'test-meta', data: JSON.stringify({ key: 'value' }) }
      ]);

      strategy.readRecord(db, 'meta', null, 'test-meta', function(err, record) {
        expect(err).to.not.exist;
        expect(record).to.exist;
        expect(record.id).to.equal('test-meta');
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
  });
});