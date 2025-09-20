/**
 * Tests for DefaultSchemaStrategy
 */

var expect = require('chai').expect;
var DefaultSchemaStrategy = require('../../lib/schema/default-schema-strategy');
var TestDbHelper = require('../helpers/test-db-helper');

describe('DefaultSchemaStrategy', function() {
  var strategy;
  var db;
  var helper;

  beforeEach(async function() {
    helper = new TestDbHelper('default-schema');
    db = await helper.createAdapter();
  });

  afterEach(async function() {
    await helper.cleanup();
  });

  after(function() {
    TestDbHelper.cleanupAll();
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

    it('should create docs and meta tables', async function() {
      await new Promise(function(resolve, reject) {
        strategy.initializeSchema(db, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });

      // Check tables exist by querying sqlite_master
      const tables = await db.getAllAsync(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );

      const tableNames = tables.map(function(t) { return t.name; });
      expect(tableNames).to.include('docs');
      expect(tableNames).to.include('meta');
    });

    it('should use schema prefix for table names', async function() {
      // For schema prefix test, we'd need attachment support
      // Skip this test for now as it requires ATTACH DATABASE
      this.skip();
    });

    it('should use collection mapping for table names', async function() {
      strategy = new DefaultSchemaStrategy({
        collectionMapping: function(collection) {
          return 'custom_' + collection;
        }
      });

      await new Promise(function(resolve, reject) {
        strategy.initializeSchema(db, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });

      // Check tables exist
      const tables = await db.getAllAsync(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );

      const tableNames = tables.map(function(t) { return t.name; });
      expect(tableNames).to.include('custom_docs');
      expect(tableNames).to.include('custom_meta');
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
    beforeEach(async function() {
      strategy = new DefaultSchemaStrategy();
      // Initialize schema
      await new Promise(function(resolve, reject) {
        strategy.initializeSchema(db, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });
    });

    it('should write docs records', async function() {
      var records = {
        docs: [
          { id: 'terms/doc1', payload: { content: 'test1' } },
          { id: 'terms/doc2', payload: { content: 'test2' } }
        ]
      };

      await new Promise(function(resolve, reject) {
        strategy.writeRecords(db, records, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });

      // Verify records were written
      const rows = await db.getAllAsync('SELECT * FROM docs ORDER BY id');
      expect(rows).to.have.lengthOf(2);
      expect(rows[0].id).to.equal('terms/doc1');
      expect(rows[1].id).to.equal('terms/doc2');
    });

    it('should write meta records', async function() {
      var records = {
        meta: [
          { id: 'meta/meta1', payload: { value: 'test1' } },
          { id: 'meta/meta2', payload: { value: 'test2' } }
        ]
      };

      await new Promise(function(resolve, reject) {
        strategy.writeRecords(db, records, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });

      // Verify records were written
      const rows = await db.getAllAsync('SELECT * FROM meta ORDER BY id');
      expect(rows).to.have.lengthOf(2);
      expect(rows[0].id).to.equal('meta/meta1');
      expect(rows[1].id).to.equal('meta/meta2');
    });

    it('should encrypt docs records when encryption is enabled', async function() {
      strategy = new DefaultSchemaStrategy({
        useEncryption: true,
        encryptionCallback: function(data) {
          return 'encrypted:' + data;
        }
      });

      // Initialize schema
      await new Promise(function(resolve, reject) {
        strategy.initializeSchema(db, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });

      var records = {
        docs: [
          { id: 'terms/doc1', payload: { content: 'secret' } }
        ]
      };

      await new Promise(function(resolve, reject) {
        strategy.writeRecords(db, records, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });

      // Verify encryption
      const row = await db.getFirstAsync('SELECT * FROM docs WHERE id = ?', ['terms/doc1']);
      const data = JSON.parse(row.data);
      expect(data.encrypted_payload).to.exist;
      expect(data.encrypted_payload).to.contain('encrypted:');
    });
  });

  describe('readRecord', function() {
    beforeEach(async function() {
      strategy = new DefaultSchemaStrategy();

      // Initialize schema
      await new Promise(function(resolve, reject) {
        strategy.initializeSchema(db, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });

      // Insert test data
      await db.runAsync(
        'INSERT INTO docs (id, data) VALUES (?, ?)',
        ['terms/doc1', JSON.stringify({ id: 'terms/doc1', payload: { content: 'test' } })]
      );
      await db.runAsync(
        'INSERT INTO meta (id, data) VALUES (?, ?)',
        ['meta/meta1', JSON.stringify({ key: 'value' })]
      );
    });

    it('should read a docs record', async function() {
      const record = await new Promise(function(resolve, reject) {
        strategy.readRecord(db, 'docs', 'terms', 'terms/doc1', function(err, record) {
          if (err) return reject(err);
          resolve(record);
        });
      });

      expect(record).to.exist;
      expect(record.id).to.equal('terms/doc1');
      expect(record.payload.content).to.equal('test');
    });

    it('should read a meta record', async function() {
      const record = await new Promise(function(resolve, reject) {
        strategy.readRecord(db, 'meta', '__meta__', 'meta/meta1', function(err, record) {
          if (err) return reject(err);
          resolve(record);
        });
      });

      expect(record).to.exist;
      expect(record.key).to.equal('value');
    });

    it('should return null for non-existent record', async function() {
      const record = await new Promise(function(resolve, reject) {
        strategy.readRecord(db, 'docs', 'terms', 'terms/nonexistent', function(err, record) {
          if (err) return reject(err);
          resolve(record);
        });
      });

      expect(record).to.be.null;
    });

    it('should decrypt encrypted records', async function() {
      strategy = new DefaultSchemaStrategy({
        useEncryption: true,
        decryptionCallback: function(data) {
          return data.replace('encrypted:', '');
        }
      });

      // Insert encrypted data
      await db.runAsync(
        'INSERT OR REPLACE INTO docs (id, data) VALUES (?, ?)',
        ['terms/doc2', JSON.stringify({
          id: 'terms/doc2',
          encrypted_payload: 'encrypted:{"content":"secret"}'
        })]
      );

      const record = await new Promise(function(resolve, reject) {
        strategy.readRecord(db, 'docs', 'terms', 'terms/doc2', function(err, record) {
          if (err) return reject(err);
          resolve(record);
        });
      });

      expect(record).to.exist;
      expect(record.payload.content).to.equal('secret');
    });
  });

  describe('readRecordsBulk', function() {
    beforeEach(async function() {
      strategy = new DefaultSchemaStrategy();

      // Initialize schema
      await new Promise(function(resolve, reject) {
        strategy.initializeSchema(db, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });

      // Insert test data
      await db.runAsync(
        'INSERT INTO docs (id, data) VALUES (?, ?)',
        ['terms/doc1', JSON.stringify({ id: 'terms/doc1', payload: { content: 'test1' } })]
      );
      await db.runAsync(
        'INSERT INTO docs (id, data) VALUES (?, ?)',
        ['terms/doc2', JSON.stringify({ id: 'terms/doc2', payload: { content: 'test2' } })]
      );
      await db.runAsync(
        'INSERT INTO docs (id, data) VALUES (?, ?)',
        ['terms/doc3', JSON.stringify({ id: 'terms/doc3', payload: { content: 'test3' } })]
      );
    });

    it('should read multiple records by ID', async function() {
      var ids = ['terms/doc1', 'terms/doc3'];

      const records = await new Promise(function(resolve, reject) {
        strategy.readRecordsBulk(db, 'docs', 'terms', ids, function(err, records) {
          if (err) return reject(err);
          resolve(records);
        });
      });

      expect(records).to.have.lengthOf(2);
      var doc1 = records.find(function(r) { return r.id === 'terms/doc1'; });
      var doc3 = records.find(function(r) { return r.id === 'terms/doc3'; });
      expect(doc1.payload.content).to.equal('test1');
      expect(doc3.payload.content).to.equal('test3');
    });

    it('should return empty array for empty ID list', async function() {
      const records = await new Promise(function(resolve, reject) {
        strategy.readRecordsBulk(db, 'docs', 'terms', [], function(err, records) {
          if (err) return reject(err);
          resolve(records);
        });
      });

      expect(records).to.be.an('array');
      expect(records).to.have.lengthOf(0);
    });
  });

  describe('deleteRecord', function() {
    beforeEach(async function() {
      strategy = new DefaultSchemaStrategy();

      // Initialize schema
      await new Promise(function(resolve, reject) {
        strategy.initializeSchema(db, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });

      // Insert test data
      await db.runAsync(
        'INSERT INTO docs (id, data) VALUES (?, ?)',
        ['terms/doc1', JSON.stringify({ id: 'terms/doc1', payload: { content: 'test' } })]
      );
    });

    it('should delete a record', async function() {
      // Verify record exists
      let row = await db.getFirstAsync('SELECT * FROM docs WHERE id = ?', ['terms/doc1']);
      expect(row).to.exist;

      // Delete it
      await new Promise(function(resolve, reject) {
        strategy.deleteRecord(db, 'docs', 'terms', 'terms/doc1', function(err) {
          if (err) return reject(err);
          resolve();
        });
      });

      // Verify it's gone
      row = await db.getFirstAsync('SELECT * FROM docs WHERE id = ?', ['terms/doc1']);
      expect(row).to.be.null;
    });
  });

  describe('inventory management', function() {
    beforeEach(async function() {
      strategy = new DefaultSchemaStrategy();

      // Initialize schema
      await new Promise(function(resolve, reject) {
        strategy.initializeSchema(db, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });
    });

    it('should initialize inventory', async function() {
      const inventory = await new Promise(function(resolve, reject) {
        strategy.initializeInventory(db, function(err, inventory) {
          if (err) return reject(err);
          resolve(inventory);
        });
      });

      expect(inventory).to.exist;
      expect(inventory.id).to.equal('inventory');
      expect(inventory.payload.collections).to.be.an('object');
    });

    it('should read inventory', async function() {
      // Insert inventory data
      await db.runAsync(
        'INSERT INTO meta (id, data) VALUES (?, ?)',
        ['inventory', JSON.stringify({
          collections: {
            terms: { doc1: 1, doc2: 2 }
          }
        })]
      );

      const inventory = await new Promise(function(resolve, reject) {
        strategy.readInventory(db, function(err, inventory) {
          if (err) return reject(err);
          resolve(inventory);
        });
      });

      expect(inventory).to.exist;
      expect(inventory.payload.collections.terms).to.exist;
      expect(inventory.payload.collections.terms.doc1).to.equal(1);
    });

    it('should update inventory item', async function() {
      // Initialize inventory
      await db.runAsync(
        'INSERT INTO meta (id, data) VALUES (?, ?)',
        ['inventory', JSON.stringify({
          collections: {
            terms: { doc1: 1 }
          }
        })]
      );

      await new Promise(function(resolve, reject) {
        strategy.updateInventoryItem(db, 'terms', 'doc2', 2, 'add', function(err) {
          if (err) return reject(err);
          resolve();
        });
      });

      // Verify update
      const row = await db.getFirstAsync('SELECT * FROM meta WHERE id = ?', ['inventory']);
      const data = JSON.parse(row.data);
      expect(data.collections.terms.doc2).to.equal(2);
    });
  });

  describe('deleteAllTables', function() {
    beforeEach(async function() {
      strategy = new DefaultSchemaStrategy();

      // Initialize schema
      await new Promise(function(resolve, reject) {
        strategy.initializeSchema(db, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });
    });

    it('should drop all tables', async function() {
      // Verify tables exist
      let tables = await db.getAllAsync(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );
      expect(tables.length).to.be.greaterThan(0);

      await new Promise(function(resolve, reject) {
        strategy.deleteAllTables(db, function(err) {
          if (err) return reject(err);
          resolve();
        });
      });

      // Verify tables are gone
      tables = await db.getAllAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('docs', 'meta', 'inventory')"
      );
      expect(tables).to.have.lengthOf(0);
    });
  });
});