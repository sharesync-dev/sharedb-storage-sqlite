/**
 * Simple integration test to verify the library works
 */

var CollectionPerTableStrategy = require('../lib/schema/collection-per-table-strategy');
var AttachedCollectionPerTableStrategy = require('../lib/schema/attached-collection-per-table-strategy');

// Simple mock database for testing
function SimpleDB() {
  this.tables = new Map();
}

SimpleDB.prototype.transaction = function(fn) {
  return fn();
};

SimpleDB.prototype.runAsync = function(sql, params) {
  console.log('SQL:', sql.substring(0, 50) + '...', params ? params.slice(0, 2) : []);
  return Promise.resolve({ changes: 1 });
};

SimpleDB.prototype.getFirstAsync = function(sql, params) {
  console.log('GET:', sql.substring(0, 50) + '...', params ? params.slice(0, 2) : []);
  return Promise.resolve(null);
};

SimpleDB.prototype.getAllAsync = function(sql, params) {
  console.log('ALL:', sql.substring(0, 50) + '...', params ? params.slice(0, 2) : []);
  return Promise.resolve([]);
};

function test() {
  console.log('Testing CollectionPerTableStrategy...');

  var strategy = new CollectionPerTableStrategy({
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
            arrayPath: 'payload.tags',
            primaryKey: ['term_id', 'tag']
          }
        ]
      }
    }
  });

  var db = new SimpleDB();

  // Initialize schema
  console.log('\nInitializing schema...');
  return strategy.initializeSchema(db)
    .then(function() {
      // Write a record
      console.log('\nWriting record...');
      return strategy.writeRecords(db, {
        docs: [
          {
            id: 'term-1',
            payload: {
              collection: 'terms',
              term: 'hello',
              tags: ['english', 'greeting'],
              v: 1
            }
          }
        ]
      });
    })
    .then(function() {
      console.log('\nTesting AttachedCollectionPerTableStrategy...');
      var attachedStrategy = new AttachedCollectionPerTableStrategy({
        collectionConfig: {
          terms: {
            indexes: ['payload.term'],
            encryptedFields: []
          }
        }
      });

      return attachedStrategy.initializeSchema(db);
    })
    .then(function() {
      console.log('\n✅ Integration test passed!');
    });
}

test().catch(console.error);