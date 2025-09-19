/**
 * Basic Projection Tests - Starting Simple
 * Build up one test at a time to ensure each works
 */

const expect = require('chai').expect;
const TestDbHelper = require('./helpers/test-db-helper');
const CollectionPerTableStrategy = require('../lib/schema/collection-per-table-strategy');

describe('Projection Basics', function() {
  let helper;
  let db;
  let strategy;

  beforeEach(async function() {
    helper = new TestDbHelper('proj-basics');
    db = await helper.createAdapter();
  });

  afterEach(async function() {
    await helper.cleanup();
  });

  after(function() {
    TestDbHelper.cleanupAll();
  });

  it('should create a projection table during schema initialization', async function() {
    // Use the exact structure from the existing tests
    const config = {
      collectionConfig: {
        terms: {
          indexes: [],
          encryptedFields: [],
          projections: [
            {
              type: 'array_expansion',
              targetTable: 'term_tags',
              mapping: {
                'term_id': 'id',
                'tag': '@element'
              },
              arrayPath: 'payload.data.payload.tags',
              primaryKey: ['term_id', 'tag']
            }
          ]
        }
      }
    };

    strategy = new CollectionPerTableStrategy(config);

    // Initialize schema
    await new Promise((resolve, reject) => {
      strategy.initializeSchema(db, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Check that the projection table was created
    const tables = await db.getAllAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='term_tags'"
    );

    expect(tables).to.have.lengthOf(1);
    expect(tables[0].name).to.equal('term_tags');
  });

  it('should create projection table with correct columns', async function() {
    const config = {
      collectionConfig: {
        terms: {
          indexes: [],
          encryptedFields: [],
          projections: [
            {
              type: 'array_expansion',
              targetTable: 'term_tags',
              mapping: {
                'term_id': 'id',
                'phrase_id': 'payload.data.payload.phrase_id',
                'tag': '@element'
              },
              arrayPath: 'payload.data.payload.tags',
              primaryKey: ['term_id', 'tag']
            }
          ]
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

    // Check the columns of the projection table
    const columns = await db.getAllAsync("PRAGMA table_info(term_tags)");
    const columnNames = columns.map(c => c.name);

    // Log to see what columns were created
    // console.log('Projection table columns:', columnNames);

    expect(columnNames).to.include('term_id');
    expect(columnNames).to.include('phrase_id');
    expect(columnNames).to.include('tag');
    // Likely includes an extra column for source/primary key
    expect(columns.length).to.be.at.least(3);
  });

  it('should populate projection table when writing document with array', async function() {
    const config = {
      collectionConfig: {
        terms: {
          indexes: [],
          encryptedFields: [],
          projections: [
            {
              type: 'array_expansion',
              targetTable: 'term_tags',
              mapping: {
                'term_id': 'id',
                'tag': '@element'
              },
              arrayPath: 'payload.data.payload.tags',
              primaryKey: ['term_id', 'tag']
            }
          ]
        }
      }
    };

    strategy = new CollectionPerTableStrategy(config);

    // Initialize schema first
    await new Promise((resolve, reject) => {
      strategy.initializeSchema(db, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Write a document with tags using double-payload structure
    const doc = {
      id: 'terms/term1',
      payload: {
        collection: 'terms',
        v: 1,
        type: 'json0',
        data: {
          payload: {
            id: 'term1',
            phrase: 'hello',
            tags: ['greeting', 'common', 'english']
          }
        }
      }
    };

    await new Promise((resolve, reject) => {
      strategy.writeRecords(db, { docs: [doc] }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Check that projection rows were created
    const projectionRows = await db.getAllAsync(
      "SELECT * FROM term_tags WHERE term_id = ? ORDER BY tag",
      ['terms/term1']
    );

    expect(projectionRows).to.have.lengthOf(3);
    expect(projectionRows[0].tag).to.equal('common');
    expect(projectionRows[1].tag).to.equal('english');
    expect(projectionRows[2].tag).to.equal('greeting');
  });

  it('should update projection when document is updated', async function() {
    const config = {
      collectionConfig: {
        terms: {
          indexes: [],
          encryptedFields: [],
          projections: [
            {
              type: 'array_expansion',
              targetTable: 'term_tags',
              mapping: {
                'term_id': 'id',
                'tag': '@element'
              },
              arrayPath: 'payload.data.payload.tags',
              primaryKey: ['term_id', 'tag']
            }
          ]
        }
      }
    };

    strategy = new CollectionPerTableStrategy(config);

    // Initialize schema
    await new Promise((resolve, reject) => {
      strategy.initializeSchema(db, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Write initial document
    const doc = {
      id: 'terms/term1',
      payload: {
        collection: 'terms',
        v: 1,
        type: 'json0',
        data: {
          payload: {
            id: 'term1',
            phrase: 'hello',
            tags: ['greeting', 'english']
          }
        }
      }
    };

    await new Promise((resolve, reject) => {
      strategy.writeRecords(db, { docs: [doc] }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Verify initial projection rows
    let projectionRows = await db.getAllAsync(
      "SELECT * FROM term_tags WHERE term_id = ? ORDER BY tag",
      ['terms/term1']
    );
    expect(projectionRows).to.have.lengthOf(2);

    // Update the document with new tags
    const updatedDoc = {
      id: 'terms/term1',
      payload: {
        collection: 'terms',
        v: 2,
        type: 'json0',
        data: {
          payload: {
            id: 'term1',
            phrase: 'hello',
            tags: ['greeting', 'common', 'friendly']
          }
        }
      }
    };

    await new Promise((resolve, reject) => {
      strategy.writeRecords(db, { docs: [updatedDoc] }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Check that projection rows were updated
    projectionRows = await db.getAllAsync(
      "SELECT * FROM term_tags WHERE term_id = ? ORDER BY tag",
      ['terms/term1']
    );

    expect(projectionRows).to.have.lengthOf(3);
    expect(projectionRows[0].tag).to.equal('common');
    expect(projectionRows[1].tag).to.equal('friendly');
    expect(projectionRows[2].tag).to.equal('greeting');
  });

  it('should handle empty array in projection', async function() {
    const config = {
      collectionConfig: {
        terms: {
          indexes: [],
          encryptedFields: [],
          projections: [
            {
              type: 'array_expansion',
              targetTable: 'term_tags',
              mapping: {
                'term_id': 'id',
                'tag': '@element'
              },
              arrayPath: 'payload.data.payload.tags',
              primaryKey: ['term_id', 'tag']
            }
          ]
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

    // Write a document with empty tags array
    const doc = {
      id: 'terms/term1',
      payload: {
        collection: 'terms',
        v: 1,
        type: 'json0',
        data: {
          payload: {
            id: 'term1',
            phrase: 'hello',
            tags: []  // Empty array
          }
        }
      }
    };

    await new Promise((resolve, reject) => {
      strategy.writeRecords(db, { docs: [doc] }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Check that no projection rows were created
    const projectionRows = await db.getAllAsync(
      "SELECT * FROM term_tags WHERE term_id = ?",
      ['terms/term1']
    );

    expect(projectionRows).to.have.lengthOf(0);
  });

  it('should handle missing array field in projection', async function() {
    const config = {
      collectionConfig: {
        terms: {
          indexes: [],
          encryptedFields: [],
          projections: [
            {
              type: 'array_expansion',
              targetTable: 'term_tags',
              mapping: {
                'term_id': 'id',
                'tag': '@element'
              },
              arrayPath: 'payload.data.payload.tags',
              primaryKey: ['term_id', 'tag']
            }
          ]
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

    // Write a document without tags field
    const doc = {
      id: 'terms/term1',
      payload: {
        collection: 'terms',
        v: 1,
        type: 'json0',
        data: {
          payload: {
            id: 'term1',
            phrase: 'hello'
            // No tags field at all
          }
        }
      }
    };

    await new Promise((resolve, reject) => {
      strategy.writeRecords(db, { docs: [doc] }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Check that no projection rows were created
    const projectionRows = await db.getAllAsync(
      "SELECT * FROM term_tags WHERE term_id = ?",
      ['terms/term1']
    );

    expect(projectionRows).to.have.lengthOf(0);
  });

  it('should handle multiple fields in projection mapping', async function() {
    const config = {
      collectionConfig: {
        terms: {
          indexes: [],
          encryptedFields: [],
          projections: [
            {
              type: 'array_expansion',
              targetTable: 'term_tags',
              mapping: {
                'term_id': 'id',
                'phrase': 'payload.data.payload.phrase',
                'category': 'payload.data.payload.category',
                'tag': '@element'
              },
              arrayPath: 'payload.data.payload.tags',
              primaryKey: ['term_id', 'tag']
            }
          ]
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

    // Write a document with tags and additional fields
    const doc = {
      id: 'terms/term1',
      payload: {
        collection: 'terms',
        v: 1,
        type: 'json0',
        data: {
          payload: {
            id: 'term1',
            phrase: 'hello',
            category: 'greetings',
            tags: ['english', 'common']
          }
        }
      }
    };

    await new Promise((resolve, reject) => {
      strategy.writeRecords(db, { docs: [doc] }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Check projection rows have all mapped fields
    const projectionRows = await db.getAllAsync(
      "SELECT * FROM term_tags WHERE term_id = ? ORDER BY tag",
      ['terms/term1']
    );

    expect(projectionRows).to.have.lengthOf(2);

    expect(projectionRows[0].term_id).to.equal('terms/term1');
    expect(projectionRows[0].phrase).to.equal('hello');
    expect(projectionRows[0].category).to.equal('greetings');
    expect(projectionRows[0].tag).to.equal('common');

    expect(projectionRows[1].term_id).to.equal('terms/term1');
    expect(projectionRows[1].phrase).to.equal('hello');
    expect(projectionRows[1].category).to.equal('greetings');
    expect(projectionRows[1].tag).to.equal('english');
  });
});