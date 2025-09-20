/**
 * Compound ID Handling Tests
 * Testing that compound IDs are properly handled - stored with full ID in documents
 * but with simple ID in inventory
 */

const expect = require('chai').expect;
const TestDbHelper = require('./helpers/test-db-helper');
const CollectionPerTableStrategy = require('../lib/schema/collection-per-table-strategy');
const AttachedCollectionPerTableStrategy = require('../lib/schema/attached-collection-per-table-strategy');

describe('Compound ID Handling', function() {
  let helper;
  let db;
  let strategy;

  beforeEach(async function() {
    helper = new TestDbHelper('compound-id-test');
    db = await helper.createAdapter();
  });

  afterEach(async function() {
    await helper.cleanup();
  });

  after(function() {
    TestDbHelper.cleanupAll();
  });

  describe('CollectionPerTableStrategy', function() {
    it('should store simple ID in inventory when document has compound ID', async function() {
      const config = {
        collectionConfig: {
          manifest: {
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

      // Write a document with compound ID (as ShareDB does)
      const doc = {
        id: 'manifest/m3ttEidoeclNAhlT',
        payload: {
          collection: 'manifest',
          v: 1,
          type: 'json0',
          data: {
            type: 'manifest',
            content: 'test manifest data'
          }
        }
      };

      await new Promise((resolve, reject) => {
        strategy.writeRecords(db, { docs: [doc] }, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Check inventory - should have simple ID
      const inventoryRows = await db.getAllAsync(
        'SELECT * FROM sharedb_inventory WHERE collection = ?',
        ['manifest']
      );

      expect(inventoryRows).to.have.lengthOf(1);
      expect(inventoryRows[0].doc_id).to.equal('m3ttEidoeclNAhlT'); // Simple ID, not compound

      // Document table should have compound ID for backward compatibility
      const docRows = await db.getAllAsync(
        'SELECT * FROM manifest WHERE id = ?',
        ['manifest/m3ttEidoeclNAhlT']
      );

      expect(docRows).to.have.lengthOf(1);
      const storedDoc = JSON.parse(docRows[0].data);
      expect(storedDoc.id).to.equal('manifest/m3ttEidoeclNAhlT');
    });

    it('should reject documents with slashes in document ID', async function() {
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

      // Try to write a document with slashes in the document ID part
      const doc = {
        id: 'items/category/subcategory/item123',
        payload: {
          collection: 'items',
          v: 1,
          type: 'json0',
          data: {
            name: 'Invalid Item'
          }
        }
      };

      // Should throw an error because document ID contains slashes
      let errorThrown = false;
      try {
        await new Promise((resolve, reject) => {
          strategy.writeRecords(db, { docs: [doc] }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (error) {
        errorThrown = true;
        expect(error.message).to.include('Document ID part of compound key cannot contain slashes');
        expect(error.message).to.include('category/subcategory/item123');
      }

      expect(errorThrown).to.be.true;
    });

    it('should update inventory correctly through updateInventory method', async function() {
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

      // Call updateInventoryItem directly (as ShareDB would)
      await new Promise((resolve, reject) => {
        strategy.updateInventoryItem(db, 'users', 'user123', 5, 'add', (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Check inventory - should have simple ID
      const inventoryRows = await db.getAllAsync(
        'SELECT * FROM sharedb_inventory WHERE collection = ? AND doc_id = ?',
        ['users', 'user123']
      );

      expect(inventoryRows).to.have.lengthOf(1);
      expect(inventoryRows[0].doc_id).to.equal('user123');
      expect(inventoryRows[0].version_num).to.equal(5);
    });

    it('should not create duplicate inventory entries', async function() {
      const config = {
        collectionConfig: {
          docs: {
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

      // Write document with compound ID
      const doc = {
        id: 'docs/doc1',
        payload: {
          collection: 'docs',
          v: 1,
          type: 'json0',
          data: { content: 'test' }
        }
      };

      await new Promise((resolve, reject) => {
        strategy.writeRecords(db, { docs: [doc] }, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Update inventory separately (simulating ShareDB behavior)
      await new Promise((resolve, reject) => {
        strategy.updateInventoryItem(db, 'docs', 'doc1', 2, 'add', (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Check there's only one inventory entry
      const inventoryRows = await db.getAllAsync(
        'SELECT * FROM sharedb_inventory WHERE collection = ?',
        ['docs']
      );

      expect(inventoryRows).to.have.lengthOf(1);
      expect(inventoryRows[0].doc_id).to.equal('doc1');
      // Version should be updated to 2 from updateInventoryItem call
      expect(inventoryRows[0].version_num).to.equal(2);
    });

    it('should delete with simple ID from inventory', async function() {
      const config = {
        collectionConfig: {
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

      // Write a document
      const doc = {
        id: 'posts/post1',
        payload: {
          collection: 'posts',
          v: 1,
          type: 'json0',
          data: { title: 'Test Post' }
        }
      };

      await new Promise((resolve, reject) => {
        strategy.writeRecords(db, { docs: [doc] }, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Verify document exists in inventory
      let inventoryRows = await db.getAllAsync(
        'SELECT * FROM sharedb_inventory WHERE collection = ? AND doc_id = ?',
        ['posts', 'post1']
      );
      expect(inventoryRows).to.have.lengthOf(1);

      // Delete the document
      await new Promise((resolve, reject) => {
        strategy.deleteRecord(db, 'doc', 'posts', 'post1', (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Verify document is removed from inventory
      inventoryRows = await db.getAllAsync(
        'SELECT * FROM sharedb_inventory WHERE collection = ? AND doc_id = ?',
        ['posts', 'post1']
      );
      expect(inventoryRows).to.have.lengthOf(0);

      // Verify document is removed from collection table
      const docRows = await db.getAllAsync(
        'SELECT * FROM posts WHERE id = ?',
        ['posts/post1']
      );
      expect(docRows).to.have.lengthOf(0);
    });
  });

  describe('AttachedCollectionPerTableStrategy', function() {
    it('should inherit compound ID handling from CollectionPerTableStrategy', async function() {
      const config = {
        attachmentAlias: 'sharedb',
        collectionConfig: {
          sessions: {
            indexes: [],
            encryptedFields: []
          }
        }
      };

      strategy = new AttachedCollectionPerTableStrategy(config);
      // Remove alias for initialization (as preInitializeDatabase would)
      strategy.attachmentAlias = null;

      await new Promise((resolve, reject) => {
        strategy.initializeSchema(db, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Write a document with compound ID
      const doc = {
        id: 'sessions/session123',
        payload: {
          collection: 'sessions',
          v: 1,
          type: 'json0',
          data: {
            startTime: Date.now()
          }
        }
      };

      await new Promise((resolve, reject) => {
        strategy.writeRecords(db, { docs: [doc] }, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Check inventory - should have simple ID
      const inventoryRows = await db.getAllAsync(
        'SELECT * FROM sharedb_inventory WHERE collection = ?',
        ['sessions']
      );

      expect(inventoryRows).to.have.lengthOf(1);
      expect(inventoryRows[0].doc_id).to.equal('session123'); // Simple ID, not compound
    });
  });

  describe('Guard Against Compound IDs in Inventory', function() {
    it('should throw error when trying to directly insert compound ID in inventory via updateInventoryForRecord', async function() {
      const config = {
        collectionConfig: {
          test: {
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

      // Try to directly insert a compound ID into inventory
      let errorThrown = false;
      try {
        await strategy.updateInventoryForRecord(db, 'test', 'test/doc123', 1, false);
      } catch (error) {
        errorThrown = true;
        expect(error.message).to.include('Document ID cannot contain slashes');
        expect(error.message).to.include('test/doc123');
      }

      expect(errorThrown).to.be.true;
    });

    it('should throw error when trying to update inventory with compound ID via updateInventoryItem', async function() {
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

      // Try to update inventory with compound ID
      const result = await new Promise((resolve) => {
        strategy.updateInventoryItem(db, 'items', 'items/item456', 1, 'add', (err) => {
          resolve(err);
        });
      });

      expect(result).to.exist;
      expect(result.message).to.include('Document ID cannot contain slashes');
      expect(result.message).to.include('items/item456');
    });

    it('should throw error in AttachedCollectionPerTableStrategy when compound ID is used', async function() {
      const config = {
        attachmentAlias: 'sharedb',
        collectionConfig: {
          data: {
            indexes: [],
            encryptedFields: []
          }
        }
      };

      const attachedStrategy = new AttachedCollectionPerTableStrategy(config);
      // Remove alias for initialization
      attachedStrategy.attachmentAlias = null;

      await new Promise((resolve, reject) => {
        attachedStrategy.initializeSchema(db, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Try to insert compound ID
      let errorThrown = false;
      try {
        await attachedStrategy.updateInventoryForRecord(db, 'data', 'data/record789', 1, false);
      } catch (error) {
        errorThrown = true;
        expect(error.message).to.include('Document ID cannot contain slashes');
        expect(error.message).to.include('data/record789');
      }

      expect(errorThrown).to.be.true;
    });

    it('should reject collection names with slashes', async function() {
      const config = {
        collectionConfig: {
          test: {
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

      // Try to use a collection name with slashes
      let errorThrown = false;
      try {
        await strategy.updateInventoryForRecord(db, 'bad/collection', 'doc123', 1, false);
      } catch (error) {
        errorThrown = true;
        expect(error.message).to.include('Collection name cannot contain slashes');
        expect(error.message).to.include('bad/collection');
      }

      expect(errorThrown).to.be.true;
    });

    it('should prevent accidental storage of compound IDs through writeRecords', async function() {
      const config = {
        collectionConfig: {
          protected: {
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

      // Write a document - the compound ID should be stripped automatically
      const doc = {
        id: 'protected/doc999',
        payload: {
          collection: 'protected',
          v: 1,
          type: 'json0',
          data: { content: 'test' }
        }
      };

      await new Promise((resolve, reject) => {
        strategy.writeRecords(db, { docs: [doc] }, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      // Verify inventory has simple ID, not compound
      const inventory = await db.getAllAsync(
        'SELECT * FROM sharedb_inventory WHERE collection = ?',
        ['protected']
      );

      expect(inventory).to.have.lengthOf(1);
      expect(inventory[0].doc_id).to.equal('doc999'); // Simple ID
      expect(inventory[0].doc_id).to.not.include('/'); // No slash in inventory ID
    });
  });
});