const {expect} = require('chai');
const AttachedSqliteAdapter = require('../lib/adapters/attached-sqlite-adapter');

/**
 * Minimal stub of a wrapped adapter. Tracks calls; can simulate a closed
 * underlying connection by throwing on any operation.
 */
function makeStubAdapter() {
  const stub = {
    connected: false,
    calls: [],
    failAll: false,
    connect: function() {
      stub.connected = true;
      return Promise.resolve();
    },
    disconnect: function() {
      stub.connected = false;
      return Promise.resolve();
    },
    runAsync: function(sql) {
      stub.calls.push(sql);
      if (stub.failAll) return Promise.reject(new Error('Access to closed resource'));
      return Promise.resolve();
    },
    getFirstAsync: function(sql) {
      stub.calls.push(sql);
      if (stub.failAll) return Promise.reject(new Error('Access to closed resource'));
      return Promise.resolve(null);
    },
    getAllAsync: function(sql) {
      stub.calls.push(sql);
      if (stub.failAll) return Promise.reject(new Error('Access to closed resource'));
      if (sql === 'PRAGMA database_list') {
        return Promise.resolve([{name: 'main'}, {name: 'sharedb'}]);
      }
      return Promise.resolve([]);
    },
    transaction: function() {
      if (stub.failAll) return Promise.reject(new Error('Access to closed resource'));
      return Promise.resolve();
    }
  };
  return stub;
}

describe('AttachedSqliteAdapter after disconnect()', function() {
  let stub;
  let adapter;

  beforeEach(function() {
    stub = makeStubAdapter();
    adapter = new AttachedSqliteAdapter(stub, {
      attachments: [{path: '/tmp/attached.sqlite', alias: 'sharedb'}]
    });
    return adapter.connect();
  });

  it('rejects operations fast without touching the wrapped adapter', async function() {
    await adapter.disconnect();
    stub.failAll = true;
    const callsAtDisconnect = stub.calls.length;

    for (const op of [
      () => adapter.runAsync('INSERT INTO sharedb.term VALUES (1)'),
      () => adapter.getFirstAsync('SELECT * FROM sharedb.term'),
      () => adapter.getAllAsync('SELECT * FROM sharedb.term'),
      () => adapter.transaction([])
    ]) {
      let error = null;
      await op().catch(function(e) { error = e; });
      expect(error).to.be.an('error');
      expect(error.message).to.include('disconnected');
    }

    // No SQL (in particular no re-ATTACH) reached the underlying connection
    expect(stub.calls.length).to.equal(callsAtDisconnect);
  });

  it('does not attempt re-ATTACH from ensureAttached once closed', async function() {
    await adapter.disconnect();
    stub.failAll = true;
    stub.calls = []; // ignore the legitimate ATTACH from connect() in setup

    let error = null;
    await adapter.ensureAttached().catch(function(e) { error = e; });
    expect(error).to.be.an('error');
    expect(error.message).to.include('disconnected');
    expect(stub.calls.some(function(sql) {
      return sql.toUpperCase().includes('ATTACH DATABASE');
    })).to.equal(false);
  });

  it('does not re-ATTACH when disconnect lands mid-ensureAttached', async function() {
    // Simulate the race: ensureAttached's PRAGMA probe fails because the
    // connection just closed; the catch must not re-attach.
    stub.calls = []; // ignore the legitimate ATTACH from connect() in setup
    stub.getAllAsync = function(sql) {
      stub.calls.push(sql);
      adapter.closed = true; // disconnect() landed while the probe was in flight
      return Promise.reject(new Error('Access to closed resource'));
    };

    let error = null;
    await adapter.ensureAttached().catch(function(e) { error = e; });
    expect(error).to.be.an('error');
    expect(stub.calls.some(function(sql) {
      return sql.toUpperCase().includes('ATTACH DATABASE');
    })).to.equal(false);
  });

  it('works normally again after reconnect', async function() {
    await adapter.disconnect();
    await adapter.connect();
    await adapter.runAsync('INSERT INTO sharedb.term VALUES (1)');
    expect(adapter.closed).to.equal(false);
  });

  it('operates normally before disconnect', async function() {
    await adapter.runAsync('INSERT INTO sharedb.term VALUES (1)');
    await adapter.getAllAsync('SELECT * FROM sharedb.term');
    expect(stub.calls.length).to.be.greaterThan(0);
  });
});
