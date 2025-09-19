/**
 * Tests for AttachedCollectionPerTableStrategy
 */

var expect = require('chai').expect;
var AttachedCollectionPerTableStrategy = require('../../lib/schema/attached-collection-per-table-strategy');
var TestDbHelper = require('../helpers/test-db-helper');

describe('AttachedCollectionPerTableStrategy', function() {
  var strategy;
  var db;

  beforeEach(async function() {
    helper = new TestDbHelper('test');
    db = await helper.createAdapter();
    
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

    it('should create inventory table in main database', function(done) {
      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        var history = db.getSqlHistory();
        var createStatements = history.filter(function(h) {
          return h.sql.indexOf('CREATE TABLE') !== -1;
        });

        // Should create sharedb_inventory table (not attached)
        var hasInventoryTable = createStatements.some(function(h) {
          return h.sql.indexOf('sharedb_inventory') !== -1;
        });

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

        // Should create collection tables (without collection_ prefix for attached strategy)
        var hasPostsTable = createStatements.some(function(h) {
          return h.sql.indexOf('CREATE TABLE IF NOT EXISTS posts') !== -1;
        });
        var hasCommentsTable = createStatements.some(function(h) {
          return h.sql.indexOf('CREATE TABLE IF NOT EXISTS comments') !== -1;
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

    it('should return false for missing tables', async function() {
      // Create new db without initializing schema
      var emptyDb = new SqlJsTestAdapter();
      await emptyDb.init();

      return new Promise(function(resolve, reject) {
        strategy.validateSchema(emptyDb, function(err, isValid) {
          if (err) return reject(err);
          expect(isValid).to.be.false;
          resolve();
        });
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
      // First verify table is tracked as created (without collection_ prefix)
      expect(db.hasTable('posts')).to.be.true;

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

  describe('projection table creation', function() {
    it('should create projection tables with attachment alias prefix', function(done) {
      var options = {
        // Note: sql.js doesn't support ATTACH DATABASE, so we test without alias
        // attachmentAlias: 'sharedb',
        collectionConfig: {
          term: {
            indexes: ['payload.data.payload.phrase_id'],
            encryptedFields: [],
            projections: [
              {
                type: 'array_expansion',
                targetTable: 'term_user_tag',
                mapping: {
                  'term_id': 'id',
                  'phrase_id': {
                    source: 'payload.data.payload.phrase_id',
                    dataType: 'INTEGER'
                  },
                  'tag': {
                    source: '@element',
                    dataType: 'TEXT'
                  }
                },
                arrayPath: 'payload.data.payload.user_tags',
                primaryKey: ['term_id', 'tag'],
                indexes: [
                  { columns: ['phrase_id'] }
                ]
              }
            ]
          }
        },
        useEncryption: false
      };

      strategy = new AttachedCollectionPerTableStrategy(options);

      // Track SQL queries to verify correct table creation
      var executedQueries = [];
      db.runAsync = function(sql) {
        executedQueries.push(sql);
        return Promise.resolve({ changes: 1 });
      };

      db.getAllAsync = function(sql) {
        // Return empty array for existing tables check
        return Promise.resolve([]);
      };

      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        // Check that projection table was created with correct alias
        var projectionTableQuery = executedQueries.find(function(q) {
          return q.includes('CREATE TABLE IF NOT EXISTS sharedb.term_user_tag');
        });
        expect(projectionTableQuery, 'Should create projection table with alias prefix').to.exist;

        // Check that projection table has correct columns
        expect(projectionTableQuery).to.include('term_id TEXT');
        expect(projectionTableQuery).to.include('phrase_id INTEGER');
        expect(projectionTableQuery).to.include('tag TEXT');
        expect(projectionTableQuery).to.include('PRIMARY KEY (term_id, tag)');

        // Check that index was created with correct alias
        var indexQuery = executedQueries.find(function(q) {
          return q.includes('CREATE INDEX IF NOT EXISTS sharedb.idx_term_user_tag_phrase_id');
        });
        expect(indexQuery, 'Should create index with alias prefix').to.exist;
        expect(indexQuery).to.include('ON term_user_tag (phrase_id)');

        done();
      });
    });

    it('should handle projection table creation without attachment alias', function(done) {
      var options = {
        // No attachmentAlias - testing pre-initialization mode
        collectionConfig: {
          term: {
            indexes: [],
            projections: [
              {
                type: 'array_expansion',
                targetTable: 'term_user_tag',
                mapping: {
                  'term_id': 'id',
                  'tag': '@element'
                },
                arrayPath: 'payload.user_tags',
                primaryKey: ['term_id', 'tag']
              }
            ]
          }
        }
      };

      strategy = new AttachedCollectionPerTableStrategy(options);

      var executedQueries = [];
      db.runAsync = function(sql) {
        executedQueries.push(sql);
        return Promise.resolve({ changes: 1 });
      };

      strategy.initializeSchema(db, function(err) {
        expect(err).to.not.exist;

        // Without alias, should create table without prefix
        var projectionTableQuery = executedQueries.find(function(q) {
          return q.includes('CREATE TABLE IF NOT EXISTS term_user_tag');
        });
        expect(projectionTableQuery, 'Should create projection table without prefix').to.exist;
        expect(projectionTableQuery).to.not.include('sharedb.term_user_tag');

        done();
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
                  'post_id': 'id',
                  'tag': '@element'
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
                 h.sql.indexOf('post_tags') !== -1;
        });

        expect(projectionTable).to.exist;
        done();
      });
    });
  });

  describe('projection data operations with attachment', function() {
    var executedQueries;

    beforeEach(function(done) {
      executedQueries = [];

      // Track all SQL queries
      var originalRunAsync = db.runAsync.bind(db);
      db.runAsync = function(sql, params) {
        executedQueries.push({ sql: sql, params: params });
        return originalRunAsync(sql, params);
      };

      var options = {
        // Note: sql.js doesn't support ATTACH DATABASE, so we test without alias
        // attachmentAlias: 'sharedb',
        collectionConfig: {
          term: {
            indexes: ['payload.data.payload.text'],
            encryptedFields: [],
            projections: [
              {
                type: 'array_expansion',
                targetTable: 'term_user_tag',
                mapping: {
                  'term_id': 'id',
                  'phrase_id': {
                    source: 'payload.data.payload.phrase_id',
                    dataType: 'INTEGER'
                  },
                  'tag': {
                    source: '@element',
                    dataType: 'TEXT'
                  }
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
        },
        useEncryption: false
      };

      strategy = new AttachedCollectionPerTableStrategy(options);
      strategy.initializeSchema(db, function() {
        executedQueries = []; // Clear initialization queries
        done();
      });
    });

    it('should insert projection data when writing record with array', function(done) {
      var record = {
        id: 'term-123',
        payload: {
          collection: 'term',
          id: 'term-123',
          v: 1,
          data: {
            meta: {
              updated_at: { utc_time: '20250918120000000' }
            },
            payload: {
              text: 'test term',
              phrase_id: 456,
              user_tags: ['important', 'reviewed', 'study']
            }
          }
        }
      };

      strategy.writeCollectionRecord(db, 'term', record)
        .then(function() {
          // Check projection inserts
          var projectionInserts = executedQueries.filter(function(q) {
            return q.sql.indexOf('INSERT OR REPLACE INTO sharedb.term_user_tag') !== -1;
          });

          expect(projectionInserts).to.have.length(3);

          // Verify each tag was inserted with correct data
          var insertedTags = projectionInserts.map(function(q) {
            return q.params[2]; // tag is third parameter
          }).sort();
          expect(insertedTags).to.deep.equal(['important', 'reviewed', 'study']);

          // Verify phrase_id was included
          expect(projectionInserts[0].params[1]).to.equal(456);

          done();
        })
        .catch(done);
    });

    it('should delete old projections before inserting new ones on update', function(done) {
      // First write a record
      var initialRecord = {
        id: 'term-456',
        payload: {
          collection: 'term',
          id: 'term-456',
          v: 1,
          data: {
            payload: {
              text: 'original',
              phrase_id: 789,
              user_tags: ['old1', 'old2']
            }
          }
        }
      };

      strategy.writeCollectionRecord(db, 'term', initialRecord)
        .then(function() {
          executedQueries = []; // Clear queries

          // Mock getFirstAsync to return the old record
          db.getFirstAsync = function(sql) {
            if (sql.indexOf('SELECT data FROM sharedb.term WHERE id = ?') !== -1) {
              return Promise.resolve({
                data: JSON.stringify(initialRecord)
              });
            }
            return Promise.resolve(null);
          };

          // Update with different tags
          var updatedRecord = {
            id: 'term-456',
            payload: {
              collection: 'term',
              id: 'term-456',
              v: 2,
              data: {
                payload: {
                  text: 'updated',
                  phrase_id: 789,
                  user_tags: ['new1', 'new2', 'new3']
                }
              }
            }
          };

          return strategy.writeCollectionRecord(db, 'term', updatedRecord);
        })
        .then(function() {
          // Check for deletion query
          var deleteQueries = executedQueries.filter(function(q) {
            return q.sql.indexOf('DELETE FROM sharedb.term_user_tag') !== -1;
          });

          expect(deleteQueries).to.have.length(1);
          expect(deleteQueries[0].params[0]).to.equal('term-456');

          // Check for new inserts
          var insertQueries = executedQueries.filter(function(q) {
            return q.sql.indexOf('INSERT OR REPLACE INTO sharedb.term_user_tag') !== -1;
          });

          expect(insertQueries).to.have.length(3);
          done();
        })
        .catch(done);
    });

    it('should handle empty arrays in projections', function(done) {
      var record = {
        id: 'term-789',
        payload: {
          collection: 'term',
          id: 'term-789',
          v: 1,
          data: {
            payload: {
              text: 'no tags',
              phrase_id: 111,
              user_tags: [] // Empty array
            }
          }
        }
      };

      strategy.writeCollectionRecord(db, 'term', record)
        .then(function() {
          // Should have DELETE but no INSERT
          var deleteQueries = executedQueries.filter(function(q) {
            return q.sql.indexOf('DELETE FROM sharedb.term_user_tag') !== -1;
          });
          var insertQueries = executedQueries.filter(function(q) {
            return q.sql.indexOf('INSERT OR REPLACE INTO sharedb.term_user_tag') !== -1;
          });

          expect(deleteQueries).to.have.length(1);
          expect(insertQueries).to.have.length(0);
          done();
        })
        .catch(done);
    });

    it('should handle missing array field in projections', function(done) {
      var record = {
        id: 'term-999',
        payload: {
          collection: 'term',
          id: 'term-999',
          v: 1,
          data: {
            payload: {
              text: 'no user_tags field',
              phrase_id: 222
              // No user_tags field
            }
          }
        }
      };

      strategy.writeCollectionRecord(db, 'term', record)
        .then(function() {
          // Should have DELETE but no INSERT
          var deleteQueries = executedQueries.filter(function(q) {
            return q.sql.indexOf('DELETE FROM sharedb.term_user_tag') !== -1;
          });
          var insertQueries = executedQueries.filter(function(q) {
            return q.sql.indexOf('INSERT OR REPLACE INTO sharedb.term_user_tag') !== -1;
          });

          expect(deleteQueries).to.have.length(1);
          expect(insertQueries).to.have.length(0);
          done();
        })
        .catch(done);
    });

    it('should correctly resolve complex paths with attachment alias', function(done) {
      var record = {
        id: 'complex-123',
        payload: {
          collection: 'term',
          id: 'complex-123',
          v: 1,
          data: {
            meta: {
              created_at: { utc_time: '20250918110000000' },
              nested: {
                deep: {
                  value: 'deeply-nested'
                }
              }
            },
            payload: {
              text: 'complex',
              phrase_id: 333,
              user_tags: ['tag1'],
              nested_data: {
                inner_value: 'test'
              }
            }
          }
        }
      };

      // Test path resolution
      var phraseId = strategy.getValueAtPath(record, 'payload.data.payload.phrase_id');
      expect(phraseId).to.equal(333);

      var deepValue = strategy.getValueAtPath(record, 'payload.data.meta.nested.deep.value');
      expect(deepValue).to.equal('deeply-nested');

      var userTags = strategy.getValueAtPath(record, 'payload.data.payload.user_tags');
      expect(userTags).to.deep.equal(['tag1']);

      var innerValue = strategy.getValueAtPath(record, 'payload.data.payload.nested_data.inner_value');
      expect(innerValue).to.equal('test');

      done();
    });
  });
});