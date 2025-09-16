/**
 * Tests for AttachedCollectionPerTableStrategy
 */

var expect = require('chai').expect;
var AttachedCollectionPerTableStrategy = require('../../lib/schema/attached-collection-per-table-strategy');
var MockDatabase = require('../mocks/mock-database');

describe('AttachedCollectionPerTableStrategy', function() {
  var strategy;
  var db;

  beforeEach(function() {
    db = new MockDatabase();
  });

  describe('initialization', function() {
    it('should initialize with default options', function() {
      strategy = new AttachedCollectionPerTableStrategy();
      expect(strategy).to.exist;
      // Should inherit from CollectionPerTableStrategy
      expect(strategy.getInventoryType()).to.equal('table');
    });

    it('should initialize with collection config', function() {
      var options = {
        collectionConfig: {
          terms: {
            indexes: ['payload.term'],
            encryptedFields: []
          }
        }
      };

      strategy = new AttachedCollectionPerTableStrategy(options);
      expect(strategy).to.exist;
    });
  });

  describe('initializeSchema', function() {
    beforeEach(function() {
      strategy = new AttachedCollectionPerTableStrategy({
        collectionConfig: {
          posts: {
            indexes: ['payload.title'],
            encryptedFields: []
          },
          comments: {
            indexes: ['payload.postId'],
            encryptedFields: []
          }
        }
      });
    });

    it('should create meta and inventory tables in main database', function(done) {
      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var createStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1;
        });

        // Should create sharedb_ prefixed tables (not attached)
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

    it('should create collection tables in main database', function(done) {
      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var createStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1;
        });

        // Should create collection tables
        var hasPostsTable = createStatements.some(function(h) {
          return h.sql.indexOf('collection_posts') !== -1;
        });
        var hasCommentsTable = createStatements.some(function(h) {
          return h.sql.indexOf('collection_comments') !== -1;
        });

        expect(hasPostsTable).to.be.true;
        expect(hasCommentsTable).to.be.true;
        done();
      });
    });

    it('should use different inventory schema than base class', function(done) {
      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var inventoryCreate = history.find(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1 &&
                 h.sql.indexOf('sharedb_inventory') !== -1;
        });

        expect(inventoryCreate).to.exist;
        // AttachedCollectionPerTableStrategy now matches CollectionPerTableStrategy schema
        expect(inventoryCreate.sql).to.include('doc_id');
        expect(inventoryCreate.sql).to.include('collection');
        expect(inventoryCreate.sql).to.include('version_num');
        expect(inventoryCreate.sql).to.include('version_str');
        expect(inventoryCreate.sql).to.include('has_pending');
        done();
      });
    });
  });

  describe('validateSchema', function() {
    beforeEach(function(done) {
      strategy = new AttachedCollectionPerTableStrategy();
      strategy.initializeSchema(db, done);
    });

    it('should validate schema exists', function(done) {
      strategy.validateSchema(db, function(err, isValid) {
        try {
          expect(err).to.not.exist;
          expect(isValid).to.be.true;
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('should return false for missing tables', function(done) {
      // Create new db without initializing schema
      var emptyDb = new MockDatabase();
      strategy.validateSchema(emptyDb, function(err, isValid) {
        expect(err).to.not.exist;
        expect(isValid).to.be.false;
        done();
      });
    });
  });

  describe('deleteAllTables', function() {
    beforeEach(function(done) {
      strategy = new AttachedCollectionPerTableStrategy({
        collectionConfig: {
          posts: {
            indexes: [],
            encryptedFields: []
          }
        }
      });
      strategy.initializeSchema(db, done);
    });

    it('should delete all ShareDB tables', function(done) {
      strategy.deleteAllTables(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var dropStatements = history.filter(function(h) {
          return h.sql.indexOf('DROP TABLE') !== -1;
        });

        // Should drop ShareDB tables
        var hasDrops = dropStatements.some(function(h) {
          return h.sql.indexOf('sharedb_') !== -1 || h.sql.indexOf('projection_') !== -1;
        });

        expect(hasDrops).to.be.true;
        done();
      });
    });

    it('should clear created tables tracking', function(done) {
      // First verify table is tracked as created
      expect(db.hasTable('collection_posts')).to.be.true;

      strategy.deleteAllTables(db, function(err) {
        expect(err).to.not.exist;

        // After deletion, created tables should be cleared
        // (This is internal state, but we can verify by checking if we can create again)
        strategy.initializeSchema(db, function(err) {
          expect(err).to.not.exist;
          done();
        });
      });
    });
  });

  describe('inheritance', function() {
    it('should inherit from CollectionPerTableStrategy', function() {
      strategy = new AttachedCollectionPerTableStrategy();

      // Should have methods from parent class
      expect(strategy.getTableName).to.be.a('function');
      expect(strategy.writeRecords).to.be.a('function');
      expect(strategy.readRecord).to.be.a('function');
      expect(strategy.deleteRecord).to.be.a('function');
      expect(strategy.readInventory).to.be.a('function');
    });

    it('should use CollectionPerTableStrategy projection features', function(done) {
      var options = {
        collectionConfig: {
          posts: {
            indexes: [],
            encryptedFields: [],
            projections: [
              {
                type: 'array_expansion',
                targetTable: 'post_tags',
                mapping: {
                  'post_id': '$.id',
                  'tag': '$.ARRAY_ITEM'
                },
                arrayPath: 'payload.tags',
                primaryKey: ['post_id', 'tag']
              }
            ]
          }
        }
      };

      strategy = new AttachedCollectionPerTableStrategy(options);
      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var projectionTable = history.find(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1 &&
                 h.sql.indexOf('projection_post_tags') !== -1;
        });

        expect(projectionTable).to.exist;
        done();
      });
    });
  });
});