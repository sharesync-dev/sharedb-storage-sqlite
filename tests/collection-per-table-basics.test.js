/**
 * Basic CollectionPerTableStrategy Tests
 * Testing core functionality with real SQLite
 */

const expect = require('chai').expect;
const TestDbHelper = require('./helpers/test-db-helper');
const CollectionPerTableStrategy = require('../lib/schema/collection-per-table-strategy');

describe('CollectionPerTableStrategy Basics', function() {
  let helper;
  let db;
  let strategy;

  beforeEach(async function() {
    helper = new TestDbHelper('cpt-basics');
    db = await helper.createAdapter();
  });

  afterEach(async function() {
    await helper.cleanup();
  });

  after(function() {
    TestDbHelper.cleanupAll();
  });

  it('should initialize with default options', async function() {
    strategy = new CollectionPerTableStrategy();

    await new Promise((resolve, reject) => {
      strategy.initializeSchema(db, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Check that inventory table was created
    const tables = await db.getAllAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sharedb_inventory'"
    );
    expect(tables).to.have.lengthOf(1);
  });

  it('should create collection tables for configured collections', async function() {
    const config = {
      collectionConfig: {
        users: {
          indexes: [],
          encryptedFields: []
        },
        posts: {
          indexes: [],
          encryptedFields: []
        }
      }
    };

    strategy = new CollectionPerTableStrategy(config);

    await new Promise((resolve, reject) => {
      strategy.initializeSchema(db, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Check that collection tables were created
    const tables = await db.getAllAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'posts') ORDER BY name"
    );

    expect(tables).to.have.lengthOf(2);
    expect(tables[0].name).to.equal('posts');
    expect(tables[1].name).to.equal('users');
  });

  it('should write and read documents', async function() {
    const config = {
      collectionConfig: {
        users: {
          indexes: [],
          encryptedFields: []
        }
      }
    };

    strategy = new CollectionPerTableStrategy(config);

    await new Promise((resolve, reject) => {
      strategy.initializeSchema(db, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Write a document
    const doc = {
      id: 'users/user1',
      payload: {
        collection: 'users',
        v: 1,
        type: 'json0',
        data: {
          name: 'Alice',
          email: 'alice@example.com'
        }
      }
    };

    await new Promise((resolve, reject) => {
      strategy.writeRecords(db, { docs: [doc] }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Read the document back
    const result = await new Promise((resolve, reject) => {
      strategy.readRecord(db, 'doc', 'users', 'user1', (err, record) => {
        if (err) return reject(err);
        resolve(record);
      });
    });

    expect(result).to.exist;
    expect(result.id).to.equal('users/user1');
    expect(result.payload.data.name).to.equal('Alice');
  });

  it('should handle compound IDs correctly', async function() {
    const config = {
      collectionConfig: {
        items: {
          indexes: [],
          encryptedFields: []
        }
      }
    };

    strategy = new CollectionPerTableStrategy(config);

    await new Promise((resolve, reject) => {
      strategy.initializeSchema(db, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Write a document with compound ID
    const doc = {
      id: 'items/category/subcategory/item1',
      payload: {
        collection: 'items',
        v: 1,
        type: 'json0',
        data: {
          title: 'Test Item'
        }
      }
    };

    await new Promise((resolve, reject) => {
      strategy.writeRecords(db, { docs: [doc] }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Read the document back
    const result = await new Promise((resolve, reject) => {
      strategy.readRecord(db, 'doc', 'items', 'category/subcategory/item1', (err, record) => {
        if (err) return reject(err);
        resolve(record);
      });
    });

    expect(result).to.exist;
    expect(result.id).to.equal('items/category/subcategory/item1');
    expect(result.payload.data.title).to.equal('Test Item');
  });

  it('should update inventory when writing documents', async function() {
    const config = {
      collectionConfig: {
        articles: {
          indexes: [],
          encryptedFields: []
        }
      }
    };

    strategy = new CollectionPerTableStrategy(config);

    await new Promise((resolve, reject) => {
      strategy.initializeSchema(db, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Write documents
    const docs = [
      {
        id: 'articles/article1',
        payload: {
          collection: 'articles',
          v: 1,
          type: 'json0',
          data: { title: 'Article 1' }
        }
      },
      {
        id: 'articles/article2',
        payload: {
          collection: 'articles',
          v: 1,
          type: 'json0',
          data: { title: 'Article 2' }
        }
      }
    ];

    await new Promise((resolve, reject) => {
      strategy.writeRecords(db, { docs }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Check inventory
    const inventory = await db.getAllAsync(
      "SELECT * FROM sharedb_inventory WHERE collection = 'articles' ORDER BY doc_id"
    );

    expect(inventory).to.have.lengthOf(2);
    expect(inventory[0].doc_id).to.equal('articles/article1');
    expect(inventory[1].doc_id).to.equal('articles/article2');
  });

  it('should delete documents and update inventory', async function() {
    const config = {
      collectionConfig: {
        notes: {
          indexes: [],
          encryptedFields: []
        }
      }
    };

    strategy = new CollectionPerTableStrategy(config);

    await new Promise((resolve, reject) => {
      strategy.initializeSchema(db, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Write a document
    const doc = {
      id: 'notes/note1',
      payload: {
        collection: 'notes',
        v: 1,
        type: 'json0',
        data: { content: 'Test note' }
      }
    };

    await new Promise((resolve, reject) => {
      strategy.writeRecords(db, { docs: [doc] }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Verify document exists
    let result = await new Promise((resolve, reject) => {
      strategy.readRecord(db, 'doc', 'notes', 'note1', (err, record) => {
        if (err) return reject(err);
        resolve(record);
      });
    });
    expect(result).to.exist;

    // Delete the document
    await new Promise((resolve, reject) => {
      strategy.deleteRecord(db, 'doc', 'notes', 'note1', (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Verify document is deleted
    result = await new Promise((resolve, reject) => {
      strategy.readRecord(db, 'doc', 'notes', 'note1', (err, record) => {
        if (err) return reject(err);
        resolve(record);
      });
    });
    expect(result).to.be.null;

    // Check inventory is empty after delete
    const inventory = await db.getAllAsync(
      "SELECT * FROM sharedb_inventory WHERE collection = 'notes'"
    );
    expect(inventory).to.have.lengthOf(0);
  });

  it('should create indexes on collection tables', async function() {
    const config = {
      collectionConfig: {
        products: {
          indexes: ['category', 'price'],  // Field names to index
          encryptedFields: []
        }
      }
    };

    strategy = new CollectionPerTableStrategy(config);

    await new Promise((resolve, reject) => {
      strategy.initializeSchema(db, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Check that indexes were created
    const indexes = await db.getAllAsync(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='products' AND name LIKE 'idx_%' ORDER BY name"
    );

    expect(indexes.length).to.be.at.least(2);
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).to.include('idx_products_category');
    expect(indexNames).to.include('idx_products_price');
  });
});