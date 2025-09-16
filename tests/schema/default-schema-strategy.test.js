/**
 * Tests for DefaultSchemaStrategy
 */

var expect = require('chai').expect;
var DefaultSchemaStrategy = require('../../lib/schema/default-schema-strategy');
var MockDatabase = require('../mocks/mock-database');

describe('DefaultSchemaStrategy', function() {
  var strategy;
  var db;

  beforeEach(function() {
    db = new MockDatabase();
  });

  describe('initialization', function() {
    it('should initialize with default options', function() {
      strategy = new DefaultSchemaStrategy();
      expect(strategy).to.exist;
      expect(strategy.getInventoryType()).to.equal('json');
    });

    it('should initialize with encryption options', function() {
      var options = {
        useEncryption: true,
        encryptionCallback: function(data) { return 'encrypted_' + data; },
        decryptionCallback: function(data) { return data.replace('encrypted_', ''); }
      };

      strategy = new DefaultSchemaStrategy(options);
      expect(strategy.useEncryption).to.be.true;
      expect(strategy.encryptionCallback).to.exist;
      expect(strategy.decryptionCallback).to.exist;
    });

    it('should initialize with schema prefix', function() {
      var options = {
        schemaPrefix: 'test_schema'
      };

      strategy = new DefaultSchemaStrategy(options);
      expect(strategy.schemaPrefix).to.equal('test_schema');
      expect(strategy.getInventoryType()).to.equal('test_schema-json');
    });

    it('should initialize with collection mapping', function() {
      var options = {
        collectionMapping: function(collection) {
          return 'mapped_' + collection;
        }
      };

      strategy = new DefaultSchemaStrategy(options);
      expect(strategy.collectionMapping).to.exist;
    });
  });

  describe('initializeSchema', function() {
    beforeEach(function() {
      strategy = new DefaultSchemaStrategy();
    });

    it('should create docs and meta tables', function(done) {
      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var createStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1;
        });

        var hasDocsTable = createStatements.some(function(h) {
          return h.sql.indexOf(' docs ') !== -1;
        });
        var hasMetaTable = createStatements.some(function(h) {
          return h.sql.indexOf(' meta ') !== -1;
        });

        expect(hasDocsTable).to.be.true;
        expect(hasMetaTable).to.be.true;
        done();
      });
    });

    it('should use schema prefix for table names', function(done) {
      strategy = new DefaultSchemaStrategy({ schemaPrefix: 'test' });

      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var createStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1;
        });

        var hasPrefixedDocs = createStatements.some(function(h) {
          return h.sql.indexOf('test.docs') !== -1;
        });
        var hasPrefixedMeta = createStatements.some(function(h) {
          return h.sql.indexOf('test.meta') !== -1;
        });

        expect(hasPrefixedDocs).to.be.true;
        expect(hasPrefixedMeta).to.be.true;
        done();
      });
    });

    it('should use collection mapping for table names', function(done) {
      strategy = new DefaultSchemaStrategy({
        collectionMapping: function(collection) {
          return 'custom_' + collection;
        }
      });

      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var createStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1;
        });

        var hasCustomDocs = createStatements.some(function(h) {
          return h.sql.indexOf('custom_docs') !== -1;
        });
        var hasCustomMeta = createStatements.some(function(h) {
          return h.sql.indexOf('custom_meta') !== -1;
        });

        expect(hasCustomDocs).to.be.true;
        expect(hasCustomMeta).to.be.true;
        done();
      });
    });
  });

  describe('getTableName', function() {
    it('should return docs table for regular collections', function() {
      strategy = new DefaultSchemaStrategy();
      expect(strategy.getTableName('terms')).to.equal('docs');
      expect(strategy.getTableName('sessions')).to.equal('docs');
    });

    it('should return meta table for __meta__ collection', function() {
      strategy = new DefaultSchemaStrategy();
      expect(strategy.getTableName('__meta__')).to.equal('meta');
    });

    it('should apply schema prefix', function() {
      strategy = new DefaultSchemaStrategy({ schemaPrefix: 'test' });
      expect(strategy.getTableName('terms')).to.equal('test.docs');
      expect(strategy.getTableName('__meta__')).to.equal('test.meta');
    });

    it('should apply collection mapping', function() {
      strategy = new DefaultSchemaStrategy({
        collectionMapping: function(collection) {
          return 'mapped_' + collection;
        }
      });
      expect(strategy.getTableName('terms')).to.equal('mapped_terms');
      expect(strategy.getTableName('__meta__')).to.equal('mapped_meta');
    });
  });

  describe('writeRecords', function() {
    beforeEach(function() {
      strategy = new DefaultSchemaStrategy();
    });

    it('should write docs records', function(done) {
      var records = {
        docs: [
          { id: 'doc1', payload: { content: 'test1' } },
          { id: 'doc2', payload: { content: 'test2' } }
        ]
      };

      strategy.writeRecords(db, records, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var insertStatements = history.filter(function(h) {
          return h.sql.indexOf('INSERT OR REPLACE INTO docs') !== -1;
        });

        expect(insertStatements).to.have.lengthOf(2);
        expect(insertStatements[0].params[0]).to.equal('doc1');
        expect(insertStatements[1].params[0]).to.equal('doc2');
        done();
      });
    });

    it('should write meta records', function(done) {
      var records = {
        meta: [
          { id: 'meta1', payload: { value: 'test1' } },
          { id: 'meta2', payload: { value: 'test2' } }
        ]
      };

      strategy.writeRecords(db, records, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var insertStatements = history.filter(function(h) {
          return h.sql.indexOf('INSERT OR REPLACE INTO meta') !== -1;
        });

        expect(insertStatements).to.have.lengthOf(2);
        expect(insertStatements[0].params[0]).to.equal('meta1');
        expect(insertStatements[1].params[0]).to.equal('meta2');
        done();
      });
    });

    it('should encrypt docs records when encryption is enabled', function(done) {
      strategy = new DefaultSchemaStrategy({
        useEncryption: true,
        encryptionCallback: function(data) {
          return 'encrypted:' + data;
        }
      });

      var records = {
        docs: [
          { id: 'doc1', payload: { content: 'secret' } }
        ]
      };

      strategy.writeRecords(db, records, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var insertStatement = history.find(function(h) {
          return h.sql.indexOf('INSERT OR REPLACE INTO docs') !== -1;
        });

        var insertedData = JSON.parse(insertStatement.params[1]);
        expect(insertedData.encrypted_payload).to.exist;
        expect(insertedData.encrypted_payload).to.contain('encrypted:');
        done();
      });
    });
  });

  describe('readRecord', function() {
    beforeEach(function() {
      strategy = new DefaultSchemaStrategy();

      // Mock database with some data
      db.setMockData('docs', [
        { id: 'doc1', data: JSON.stringify({ id: 'doc1', payload: { content: 'test' } }) }
      ]);
      db.setMockData('meta', [
        { id: 'meta1', data: JSON.stringify({ key: 'value' }) }
      ]);
    });

    it('should read a docs record', function(done) {
      strategy.readRecord(db, 'docs', 'terms', 'doc1', function(err, record) {
        expect(err).to.not.exist;
        expect(record).to.exist;
        expect(record.id).to.equal('doc1');
        expect(record.payload.content).to.equal('test');
        done();
      });
    });

    it('should read a meta record', function(done) {
      strategy.readRecord(db, 'meta', '__meta__', 'meta1', function(err, record) {
        expect(err).to.not.exist;
        expect(record).to.exist;
        expect(record.key).to.equal('value');
        done();
      });
    });

    it('should return null for non-existent record', function(done) {
      strategy.readRecord(db, 'docs', 'terms', 'nonexistent', function(err, record) {
        expect(err).to.not.exist;
        expect(record).to.be.null;
        done();
      });
    });

    it('should decrypt encrypted records', function(done) {
      strategy = new DefaultSchemaStrategy({
        useEncryption: true,
        decryptionCallback: function(data) {
          return data.replace('encrypted:', '');
        }
      });

      db.setMockData('docs', [
        {
          id: 'doc1',
          data: JSON.stringify({
            id: 'doc1',
            encrypted_payload: 'encrypted:{"content":"secret"}'
          })
        }
      ]);

      strategy.readRecord(db, 'docs', 'terms', 'doc1', function(err, record) {
        expect(err).to.not.exist;
        expect(record).to.exist;
        expect(record.payload.content).to.equal('secret');
        done();
      });
    });
  });

  describe('readRecordsBulk', function() {
    beforeEach(function() {
      strategy = new DefaultSchemaStrategy();

      // Mock database with some data
      db.setMockData('docs', [
        { id: 'doc1', data: JSON.stringify({ id: 'doc1', payload: { content: 'test1' } }) },
        { id: 'doc2', data: JSON.stringify({ id: 'doc2', payload: { content: 'test2' } }) },
        { id: 'doc3', data: JSON.stringify({ id: 'doc3', payload: { content: 'test3' } }) }
      ]);
    });

    it('should read multiple records by ID', function(done) {
      var ids = ['doc1', 'doc3'];

      strategy.readRecordsBulk(db, 'docs', 'terms', ids, function(err, records) {
        expect(err).to.not.exist;
        expect(records).to.have.lengthOf(2);

        var doc1 = records.find(function(r) { return r.id === 'doc1'; });
        var doc3 = records.find(function(r) { return r.id === 'doc3'; });

        expect(doc1.payload.content).to.equal('test1');
        expect(doc3.payload.content).to.equal('test3');
        done();
      });
    });

    it('should return empty array for empty ID list', function(done) {
      strategy.readRecordsBulk(db, 'docs', 'terms', [], function(err, records) {
        expect(err).to.not.exist;
        expect(records).to.be.an('array');
        expect(records).to.have.lengthOf(0);
        done();
      });
    });
  });

  describe('deleteRecord', function() {
    beforeEach(function() {
      strategy = new DefaultSchemaStrategy();
    });

    it('should delete a record', function(done) {
      strategy.deleteRecord(db, 'docs', 'terms', 'doc1', function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var deleteStatement = history.find(function(h) {
          return h.sql.indexOf('DELETE FROM docs') !== -1;
        });

        expect(deleteStatement).to.exist;
        expect(deleteStatement.params[0]).to.equal('doc1');
        done();
      });
    });
  });

  describe('inventory management', function() {
    beforeEach(function() {
      strategy = new DefaultSchemaStrategy();
    });

    it('should initialize inventory', function(done) {
      strategy.initializeInventory(db, function(err, inventory) {
        expect(err).to.not.exist;
        expect(inventory).to.exist;
        expect(inventory.id).to.equal('inventory');
        expect(inventory.payload.collections).to.be.an('object');
        done();
      });
    });

    it('should read inventory', function(done) {
      // Set up mock inventory data
      db.setMockData('meta', [
        {
          id: 'inventory',
          data: JSON.stringify({
            collections: {
              terms: { doc1: 1, doc2: 2 }
            }
          })
        }
      ]);

      strategy.readInventory(db, function(err, inventory) {
        expect(err).to.not.exist;
        expect(inventory).to.exist;
        expect(inventory.payload.collections.terms).to.exist;
        expect(inventory.payload.collections.terms.doc1).to.equal(1);
        done();
      });
    });

    it('should update inventory item', function(done) {
      // Initialize with existing inventory
      db.setMockData('meta', [
        {
          id: 'inventory',
          data: JSON.stringify({
            collections: {
              terms: { doc1: 1 }
            }
          })
        }
      ]);

      strategy.updateInventoryItem(db, 'terms', 'doc2', 2, 'add', function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var updateStatement = history.find(function(h) {
          return h.sql.indexOf('UPDATE meta SET data = ?') !== -1;
        });

        expect(updateStatement).to.exist;
        var updatedData = JSON.parse(updateStatement.params[0]);
        expect(updatedData.collections.terms.doc2).to.equal(2);
        done();
      });
    });
  });

  describe('deleteAllTables', function() {
    beforeEach(function() {
      strategy = new DefaultSchemaStrategy();
    });

    it('should drop all tables', function(done) {
      strategy.deleteAllTables(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var dropStatements = history.filter(function(h) {
          return h.sql.indexOf('DROP TABLE') !== -1;
        });

        var hasDropDocs = dropStatements.some(function(h) {
          return h.sql.indexOf('docs') !== -1;
        });
        var hasDropMeta = dropStatements.some(function(h) {
          return h.sql.indexOf('meta') !== -1;
        });
        var hasDropInventory = dropStatements.some(function(h) {
          return h.sql.indexOf('inventory') !== -1;
        });

        expect(hasDropDocs).to.be.true;
        expect(hasDropMeta).to.be.true;
        expect(hasDropInventory).to.be.true;
        done();
      });
    });
  });
});