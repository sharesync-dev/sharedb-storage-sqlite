/**
 * Test suite for SqlJsTestAdapter
 */

var expect = require('chai').expect;
var SqlJsTestAdapter = require('./mocks/sql-js-test-adapter');

describe('SqlJsTestAdapter', function() {
  var db;

  beforeEach(function(done) {
    db = new SqlJsTestAdapter();
    db.init().then(function() {
      done();
    });
  });

  afterEach(function() {
    if (db && db.initialized) {
      db.reset();
    }
  });

  it('should create and query tables', function(done) {
    db.runAsync('CREATE TABLE test (id TEXT PRIMARY KEY, name TEXT)')
      .then(function() {
        return db.runAsync('INSERT INTO test (id, name) VALUES (?, ?)', ['1', 'Alice']);
      })
      .then(function(result) {
        expect(result.changes).to.equal(1);
        return db.getFirstAsync('SELECT * FROM test WHERE id = ?', ['1']);
      })
      .then(function(row) {
        expect(row).to.deep.equal({ id: '1', name: 'Alice' });
        done();
      })
      .catch(done);
  });

  it('should handle transactions', function(done) {
    db.runAsync('CREATE TABLE test (id TEXT PRIMARY KEY, value INTEGER)')
      .then(function() {
        // Transaction that succeeds
        return db.transaction(function() {
          db.runAsync('INSERT INTO test (id, value) VALUES (?, ?)', ['1', 100]);
          db.runAsync('INSERT INTO test (id, value) VALUES (?, ?)', ['2', 200]);
        });
      })
      .then(function() {
        return db.getAllAsync('SELECT * FROM test ORDER BY id');
      })
      .then(function(rows) {
        expect(rows).to.have.lengthOf(2);
        expect(rows[0].value).to.equal(100);
        expect(rows[1].value).to.equal(200);
        done();
      })
      .catch(done);
  });

  it('should support JSON columns', function(done) {
    db.runAsync('CREATE TABLE docs (id TEXT PRIMARY KEY, data JSON)')
      .then(function() {
        var jsonData = JSON.stringify({ foo: 'bar', count: 42 });
        return db.runAsync('INSERT INTO docs (id, data) VALUES (?, ?)', ['doc1', jsonData]);
      })
      .then(function() {
        return db.getFirstAsync("SELECT id, json_extract(data, '$.foo') as foo FROM docs WHERE id = ?", ['doc1']);
      })
      .then(function(row) {
        expect(row.foo).to.equal('bar');
        done();
      })
      .catch(done);
  });

  it('should track SQL history', function(done) {
    db.runAsync('CREATE TABLE test (id TEXT)')
      .then(function() {
        var history = db.getSqlHistory();
        expect(history).to.have.lengthOf(1);
        expect(history[0].sql).to.equal('CREATE TABLE test (id TEXT)');
        done();
      })
      .catch(done);
  });

  it('should support setTableData helper', function(done) {
    var testData = [
      { id: '1', name: 'Alice', age: 30 },
      { id: '2', name: 'Bob', age: 25 }
    ];

    db.setTableData('users', testData);

    db.getAllAsync('SELECT * FROM users ORDER BY id')
      .then(function(rows) {
        expect(rows).to.have.lengthOf(2);
        expect(rows[0].name).to.equal('Alice');
        expect(rows[1].name).to.equal('Bob');
        done();
      })
      .catch(done);
  });

  it('should handle INSERT OR REPLACE', function(done) {
    db.runAsync('CREATE TABLE test (id TEXT PRIMARY KEY, value TEXT)')
      .then(function() {
        return db.runAsync('INSERT INTO test (id, value) VALUES (?, ?)', ['1', 'initial']);
      })
      .then(function() {
        return db.runAsync('INSERT OR REPLACE INTO test (id, value) VALUES (?, ?)', ['1', 'updated']);
      })
      .then(function() {
        return db.getAllAsync('SELECT * FROM test');
      })
      .then(function(rows) {
        expect(rows).to.have.lengthOf(1);
        expect(rows[0].value).to.equal('updated');
        done();
      })
      .catch(done);
  });
});