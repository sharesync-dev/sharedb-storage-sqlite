const { expect } = require('chai');
const { AttachedSqliteAdapter } = require('../../lib');
const MockDatabase = require('../mocks/mock-database');

describe('AttachedSqliteAdapter', function() {
  let mockDb;
  let mockAttachedDb;

  beforeEach(function() {
    // Create fresh mock databases for each test
    mockDb = new MockDatabase();
    mockAttachedDb = new MockDatabase();
  });

  describe('Basic Attachment', function() {
    it('should create adapter with attachment config', function() {
      // Create a mock adapter that mimics the SqliteAdapter interface
      const mockAdapter = {
        connect: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        runAsync: (sql, params) => mockDb.runAsync(sql, params),
        getFirstAsync: (sql, params) => mockDb.getFirstAsync(sql, params),
        getAllAsync: (sql, params) => mockDb.getAllAsync(sql, params),
        transaction: (ops) => mockDb.transaction(ops)
      };

      const adapter = new AttachedSqliteAdapter(
        mockAdapter,
        {
          attachments: [
            { path: 'mock://attached.db', alias: 'sharedb' }
          ]
        },
        false // debug
      );

      expect(adapter).to.exist;
      expect(adapter.wrappedAdapter).to.equal(mockAdapter);
      expect(adapter.attachments.length).to.equal(1);
      expect(adapter.attachments[0].alias).to.equal('sharedb');
    });

    it('should throw error without wrapped adapter', function() {
      expect(() => {
        new AttachedSqliteAdapter(null, { attachments: [] });
      }).to.throw('AttachedSqliteAdapter requires a wrapped adapter');
    });

    it('should throw error without attachment config', function() {
      const mockAdapter = { connect: () => Promise.resolve() };

      expect(() => {
        new AttachedSqliteAdapter(mockAdapter, null);
      }).to.throw('AttachedSqliteAdapter requires attachmentConfig with attachments array');
    });

    it('should connect and attach databases', async function() {
      let attachExecuted = false;
      const attachedTables = { 'test_table': [] };

      // Create a mock adapter that tracks ATTACH execution
      const mockAdapter = {
        connected: false,
        connect: function() {
          this.connected = true;
          return Promise.resolve();
        },
        disconnect: function() {
          this.connected = false;
          return Promise.resolve();
        },
        runAsync: function(sql, params) {
          if (sql.includes('ATTACH DATABASE')) {
            attachExecuted = true;
            return Promise.resolve({ changes: 0 });
          }
          return mockDb.runAsync(sql, params);
        },
        getFirstAsync: function(sql, params) {
          // Simulate attached database query
          if (sql.includes('sharedb.')) {
            if (sql.includes("sqlite_master") && sql.includes("test_table")) {
              return Promise.resolve({ name: 'test_table' });
            }
          }
          return mockDb.getFirstAsync(sql, params);
        },
        getAllAsync: (sql, params) => mockDb.getAllAsync(sql, params),
        transaction: (ops) => mockDb.transaction(ops)
      };

      const adapter = new AttachedSqliteAdapter(
        mockAdapter,
        {
          attachments: [
            { path: 'mock://attached.db', alias: 'sharedb' }
          ]
        },
        false
      );

      await adapter.connect();
      expect(mockAdapter.connected).to.equal(true);
      expect(attachExecuted).to.equal(true);
      expect(adapter.isAttached()).to.equal(true);

      // Verify we can query the "attached" database
      const result = await adapter.getFirstAsync(
        "SELECT name FROM sharedb.sqlite_master WHERE type='table' AND name='test_table'"
      );
      expect(result).to.exist;
      expect(result.name).to.equal('test_table');

      await adapter.disconnect();
      expect(mockAdapter.connected).to.equal(false);
      expect(adapter.isAttached()).to.equal(false);
    });

    it('should handle attachment failure gracefully', async function() {
      const mockAdapter = {
        connect: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        runAsync: function(sql) {
          if (sql.includes('ATTACH DATABASE')) {
            return Promise.reject(new Error('unable to open database'));
          }
          return Promise.resolve({ changes: 0 });
        }
      };

      const adapter = new AttachedSqliteAdapter(
        mockAdapter,
        {
          attachments: [
            { path: '/nonexistent/database.db', alias: 'sharedb' }
          ]
        },
        false
      );

      try {
        await adapter.connect();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('unable to open');
      }
    });
  });

  describe('Cross-Database Queries', function() {
    it('should delegate queries to wrapped adapter', async function() {
      let queryCount = 0;

      const mockAdapter = {
        connect: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        runAsync: function(sql, params) {
          if (sql.includes('ATTACH')) return Promise.resolve({ changes: 0 });
          queryCount++;
          return Promise.resolve({ changes: 1 });
        },
        getFirstAsync: function(sql, params) {
          queryCount++;
          if (sql.includes('primary_table')) {
            return Promise.resolve({ name: 'primary' });
          }
          if (sql.includes('sharedb.attached_table')) {
            return Promise.resolve({ name: 'attached' });
          }
          return Promise.resolve(null);
        },
        getAllAsync: function(sql, params) {
          queryCount++;
          return Promise.resolve([{ id: 1, name: 'test' }]);
        },
        transaction: function(ops) {
          return ops();
        }
      };

      const adapter = new AttachedSqliteAdapter(
        mockAdapter,
        {
          attachments: [
            { path: 'mock://attached.db', alias: 'sharedb' }
          ]
        },
        false
      );

      await adapter.connect();

      // Test that all query methods delegate to wrapped adapter
      await adapter.runAsync('INSERT INTO test VALUES (1)');
      const getResult = await adapter.getFirstAsync('SELECT * FROM primary_table');
      const getAllResult = await adapter.getAllAsync('SELECT * FROM test');

      expect(queryCount).to.equal(3);
      expect(getResult.name).to.equal('primary');
      expect(getAllResult.length).to.equal(1);

      // Test transaction delegation
      let transactionExecuted = false;
      await adapter.transaction(async () => {
        transactionExecuted = true;
        return 'transaction result';
      });
      expect(transactionExecuted).to.equal(true);

      await adapter.disconnect();
    });
  });

  describe('Multiple Attachments', function() {
    it('should support multiple database attachments', async function() {
      const attachedDatabases = [];

      const mockAdapter = {
        connect: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        runAsync: function(sql, params) {
          if (sql.includes('ATTACH DATABASE')) {
            // Extract alias from SQL
            const match = sql.match(/AS (\w+)$/);
            if (match) {
              attachedDatabases.push(match[1]);
            }
            return Promise.resolve({ changes: 0 });
          }
          return Promise.resolve({ changes: 0 });
        },
        getFirstAsync: function(sql) {
          if (sql.includes('db1.db1_table')) {
            return Promise.resolve({ value: 'from_db1' });
          }
          if (sql.includes('db2.db2_table')) {
            return Promise.resolve({ value: 'from_db2' });
          }
          return Promise.resolve(null);
        },
        getAllAsync: () => Promise.resolve([]),
        transaction: (ops) => ops()
      };

      const adapter = new AttachedSqliteAdapter(
        mockAdapter,
        {
          attachments: [
            { path: 'mock://db1.db', alias: 'db1' },
            { path: 'mock://db2.db', alias: 'db2' }
          ]
        },
        false
      );

      await adapter.connect();

      // Verify both databases were attached
      expect(attachedDatabases).to.include('db1');
      expect(attachedDatabases).to.include('db2');
      expect(adapter.isAttached()).to.equal(true);

      // Verify we can query from both
      const result1 = await adapter.getFirstAsync('SELECT value FROM db1.db1_table WHERE id = 1');
      expect(result1.value).to.equal('from_db1');

      const result2 = await adapter.getFirstAsync('SELECT value FROM db2.db2_table WHERE id = 1');
      expect(result2.value).to.equal('from_db2');

      await adapter.disconnect();
    });
  });

  describe('Helper Methods', function() {
    it('should check attachment status', function() {
      const mockAdapter = {
        connect: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        runAsync: () => Promise.resolve({ changes: 0 })
      };

      const adapter = new AttachedSqliteAdapter(
        mockAdapter,
        {
          attachments: [
            { path: 'mock://db.db', alias: 'sharedb' }
          ]
        },
        false
      );

      expect(adapter.isAttached()).to.equal(false);

      // Simulate successful attachment
      adapter.attached = true;
      expect(adapter.isAttached()).to.equal(true);
    });

    it('should return attached aliases', function() {
      const mockAdapter = {};

      const adapter = new AttachedSqliteAdapter(
        mockAdapter,
        {
          attachments: [
            { path: 'mock://db1.db', alias: 'sharedb' },
            { path: 'mock://db2.db', alias: 'other' }
          ]
        },
        false
      );

      const aliases = adapter.getAttachedAliases();
      expect(aliases).to.deep.equal(['sharedb', 'other']);
    });

    it('should handle empty attachments', async function() {
      const mockAdapter = {
        connected: false,
        connect: function() {
          this.connected = true;
          return Promise.resolve();
        },
        disconnect: function() {
          this.connected = false;
          return Promise.resolve();
        }
      };

      const adapter = new AttachedSqliteAdapter(
        mockAdapter,
        { attachments: [] },
        false
      );

      await adapter.connect();
      expect(mockAdapter.connected).to.equal(true);
      expect(adapter.isAttached()).to.equal(false); // No attachments, so not attached

      await adapter.disconnect();
      expect(mockAdapter.connected).to.equal(false);
    });
  });
});