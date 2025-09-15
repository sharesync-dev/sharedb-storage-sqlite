/**
 * Tests for CollectionPerTableStrategy
 */

import { CollectionPerTableStrategy } from '../../src/schema/CollectionPerTableStrategy';
import { MockDatabase } from '../mocks/MockDatabase';
import { SchemaStrategyOptions, CollectionConfig } from '../../src/schema/BaseSchemaStrategy';

describe('CollectionPerTableStrategy', () => {
  let strategy: CollectionPerTableStrategy;
  let db: MockDatabase;

  beforeEach(() => {
    db = new MockDatabase();
  });

  describe('initialization', () => {
    it('should initialize with default options', () => {
      strategy = new CollectionPerTableStrategy();
      expect(strategy).toBeDefined();
      expect(strategy.getInventoryType()).toBe('inventory');
    });

    it('should initialize with collection config', () => {
      const options: SchemaStrategyOptions = {
        collectionConfig: {
          terms: {
            indexes: ['payload.term'],
            projections: [
              {
                type: 'array_expansion',
                targetTable: 'term_tag',
                mapping: {
                  'term_id': 'id',
                  'tag': ''
                },
                arrayPath: 'payload.tags',
                primaryKey: ['term_id', 'tag']
              }
            ]
          }
        }
      };

      strategy = new CollectionPerTableStrategy(options);
      expect(strategy).toBeDefined();
    });
  });

  describe('initializeSchema', () => {
    beforeEach(() => {
      strategy = new CollectionPerTableStrategy({
        collectionConfig: {
          terms: {
            indexes: ['payload.term']
          }
        }
      });
    });

    it('should create meta and inventory tables', async () => {
      await strategy.initializeSchema(db);

      const history = db.getSqlHistory();
      const createStatements = history.filter(h => h.sql.includes('CREATE TABLE'));

      expect(createStatements.some(h => h.sql.includes('sharedb_meta'))).toBe(true);
      expect(createStatements.some(h => h.sql.includes('sharedb_inventory'))).toBe(true);
    });

    it('should create collection tables for configured collections', async () => {
      await strategy.initializeSchema(db);

      const history = db.getSqlHistory();
      const createStatements = history.filter(h => h.sql.includes('CREATE TABLE'));

      expect(createStatements.some(h => h.sql.includes('sharedb_terms'))).toBe(true);
    });

    it('should create indexes on inventory table', async () => {
      await strategy.initializeSchema(db);

      const history = db.getSqlHistory();
      const indexStatements = history.filter(h => h.sql.includes('CREATE INDEX'));

      expect(indexStatements.some(h => h.sql.includes('idx_inventory_collection'))).toBe(true);
      expect(indexStatements.some(h => h.sql.includes('idx_inventory_updated'))).toBe(true);
    });
  });

  describe('projections', () => {
    beforeEach(() => {
      const options: SchemaStrategyOptions = {
        collectionConfig: {
          terms: {
            projections: [
              {
                type: 'array_expansion',
                targetTable: 'term_tag',
                mapping: {
                  'term_id': 'id',
                  'tag': ''
                },
                arrayPath: 'payload.tags',
                primaryKey: ['term_id', 'tag']
              }
            ]
          }
        }
      };
      strategy = new CollectionPerTableStrategy(options);
    });

    it('should create projection tables', async () => {
      await strategy.initializeSchema(db);

      const history = db.getSqlHistory();
      const createStatements = history.filter(h => h.sql.includes('CREATE TABLE'));

      expect(createStatements.some(h => h.sql.includes('projection_term_tag'))).toBe(true);
    });

    it('should update projections on write', async () => {
      await strategy.initializeSchema(db);

      const record = {
        id: 'term-1',
        collection: 'terms',
        payload: {
          tags: ['chinese', 'hsk1', 'beginner']
        }
      };

      await strategy.writeRecords(db, {
        docs: {
          terms: [record]
        }
      });

      const history = db.getSqlHistory();
      const insertStatements = history.filter(h => h.sql.includes('INSERT') && h.sql.includes('projection_term_tag'));

      // Should have inserted 3 tag projections
      expect(insertStatements.length).toBe(3);
    });

    it('should delete projections on record delete', async () => {
      await strategy.initializeSchema(db);

      await strategy.deleteRecord(db, 'docs', 'terms', 'term-1');

      const history = db.getSqlHistory();
      const deleteStatements = history.filter(h => h.sql.includes('DELETE') && h.sql.includes('projection_term_tag'));

      expect(deleteStatements.length).toBeGreaterThan(0);
    });
  });

  describe('writeRecords', () => {
    beforeEach(() => {
      strategy = new CollectionPerTableStrategy();
    });

    it('should write meta records', async () => {
      await strategy.initializeSchema(db);

      const records = {
        meta: [
          { id: 'meta-1', payload: { data: 'test' } }
        ]
      };

      await strategy.writeRecords(db, records);

      const history = db.getSqlHistory();
      const insertStatements = history.filter(h =>
        h.sql.includes('INSERT OR REPLACE INTO sharedb_meta')
      );

      expect(insertStatements.length).toBe(1);
      expect(insertStatements[0].params).toEqual(['meta-1', JSON.stringify({ data: 'test' })]);
    });

    it('should write doc records to collection tables', async () => {
      await strategy.initializeSchema(db);

      const records = {
        docs: {
          terms: [
            { id: 'term-1', collection: 'terms', payload: { term: 'hello' } }
          ]
        }
      };

      await strategy.writeRecords(db, records);

      const history = db.getSqlHistory();
      const insertStatements = history.filter(h =>
        h.sql.includes('INSERT OR REPLACE INTO sharedb_terms')
      );

      expect(insertStatements.length).toBe(1);
    });

    it('should update inventory on doc write', async () => {
      await strategy.initializeSchema(db);

      const records = {
        docs: {
          terms: [
            { id: 'term-1', collection: 'terms', version: 5, payload: { term: 'hello' } }
          ]
        }
      };

      await strategy.writeRecords(db, records);

      const history = db.getSqlHistory();
      const inventoryStatements = history.filter(h =>
        h.sql.includes('INSERT OR REPLACE INTO sharedb_inventory')
      );

      expect(inventoryStatements.length).toBe(1);
      expect(inventoryStatements[0].params).toContain('term-1');
      expect(inventoryStatements[0].params).toContain('terms');
      expect(inventoryStatements[0].params).toContain(5);
    });
  });

  describe('readRecord', () => {
    beforeEach(() => {
      strategy = new CollectionPerTableStrategy();
    });

    it('should read meta records', async () => {
      await strategy.initializeSchema(db);

      // Mock data
      db.setTableData('sharedb_meta', [
        { id: 'meta-1', data: JSON.stringify({ test: 'data' }) }
      ]);

      const record = await strategy.readRecord(db, 'meta', null, 'meta-1');

      expect(record).toBeDefined();
      expect(record?.id).toBe('meta-1');
      expect(record?.payload).toEqual({ test: 'data' });
    });

    it('should read doc records from collection table', async () => {
      await strategy.initializeSchema(db);

      // Mock data
      db.setTableData('sharedb_terms', [
        { id: 'term-1', data: JSON.stringify({ id: 'term-1', collection: 'terms', payload: { term: 'hello' } }) }
      ]);

      const record = await strategy.readRecord(db, 'docs', 'terms', 'term-1');

      expect(record).toBeDefined();
      expect(record?.id).toBe('term-1');
      expect(record?.collection).toBe('terms');
    });

    it('should lookup collection from inventory if not provided', async () => {
      await strategy.initializeSchema(db);

      // Mock inventory
      db.setTableData('sharedb_inventory', [
        { doc_id: 'term-1', collection: 'terms' }
      ]);

      // Mock terms table
      db.setTableData('sharedb_terms', [
        { id: 'term-1', data: JSON.stringify({ id: 'term-1', collection: 'terms' }) }
      ]);

      const record = await strategy.readRecord(db, 'docs', null, 'term-1');

      expect(record).toBeDefined();
      expect(record?.id).toBe('term-1');
    });
  });

  describe('deleteRecord', () => {
    beforeEach(() => {
      strategy = new CollectionPerTableStrategy({
        collectionConfig: {
          terms: {
            projections: [
              {
                type: 'array_expansion',
                targetTable: 'term_tag',
                mapping: {
                  'term_id': 'id',
                  'tag': ''
                },
                arrayPath: 'payload.tags',
                primaryKey: ['term_id', 'tag']
              }
            ]
          }
        }
      });
    });

    it('should delete doc record and projections', async () => {
      await strategy.initializeSchema(db);

      await strategy.deleteRecord(db, 'docs', 'terms', 'term-1');

      const history = db.getSqlHistory();

      // Should delete from main table
      const mainDelete = history.filter(h =>
        h.sql.includes('DELETE FROM sharedb_terms')
      );
      expect(mainDelete.length).toBe(1);

      // Should delete projections
      const projectionDelete = history.filter(h =>
        h.sql.includes('DELETE FROM projection_term_tag')
      );
      expect(projectionDelete.length).toBe(1);

      // Should delete from inventory
      const inventoryDelete = history.filter(h =>
        h.sql.includes('DELETE FROM sharedb_inventory')
      );
      expect(inventoryDelete.length).toBe(1);
    });
  });

  describe('validateSchema', () => {
    beforeEach(() => {
      strategy = new CollectionPerTableStrategy();
    });

    it('should return true when schema is valid', async () => {
      await strategy.initializeSchema(db);

      // Mock the tables existence
      db.setTableData('sharedb_meta', []);
      db.setTableData('sharedb_inventory', []);

      const isValid = await strategy.validateSchema(db);
      expect(isValid).toBe(true);
    });

    it('should return false when meta table is missing', async () => {
      // Don't initialize schema, so tables don't exist
      const isValid = await strategy.validateSchema(db);
      expect(isValid).toBe(false);
    });
  });

  describe('inventory operations', () => {
    beforeEach(() => {
      strategy = new CollectionPerTableStrategy();
    });

    it('should initialize inventory', async () => {
      await strategy.initializeSchema(db);

      const inventory = await strategy.initializeInventory(db);

      expect(inventory).toBeDefined();
      expect(inventory.id).toBe('sharedb-inventory');
      expect(inventory.payload).toEqual({});
    });

    it('should read inventory', async () => {
      await strategy.initializeSchema(db);

      // Mock inventory data
      db.setTableData('sharedb_inventory', [
        { doc_id: 'doc1', collection: 'terms', version: 1 },
        { doc_id: 'doc2', collection: 'terms', version: 2 }
      ]);

      const inventory = await strategy.readInventory(db);

      expect(inventory).toBeDefined();
      expect(inventory.id).toBe('sharedb-inventory');
      expect(inventory.payload).toBeDefined();
    });

    it('should update inventory item', async () => {
      await strategy.initializeSchema(db);

      await strategy.upsertInventoryItem(db, 'terms', 'doc1', 5);

      const history = db.getSqlHistory();
      const updateStatements = history.filter(h =>
        h.sql.includes('INSERT OR REPLACE INTO sharedb_inventory')
      );

      expect(updateStatements.length).toBe(1);
      expect(updateStatements[0].params).toContain('doc1');
      expect(updateStatements[0].params).toContain('terms');
      expect(updateStatements[0].params).toContain(5);
      // Note: operation parameter is not stored, just used for logic
    });
  });

  describe('deleteAllTables', () => {
    beforeEach(() => {
      strategy = new CollectionPerTableStrategy({
        collectionConfig: {
          terms: {}
        }
      });
    });

    it('should drop all sharedb tables', async () => {
      await strategy.initializeSchema(db);

      // Mock some tables
      db.setTableData('sharedb_meta', []);
      db.setTableData('sharedb_inventory', []);
      db.setTableData('sharedb_terms', []);
      db.setTableData('projection_term_tag', []);

      await strategy.deleteAllTables(db);

      const history = db.getSqlHistory();
      const dropStatements = history.filter(h => h.sql.includes('DROP TABLE'));


      expect(dropStatements.some(h => h.sql.includes('sharedb_meta'))).toBe(true);
      expect(dropStatements.some(h => h.sql.includes('sharedb_inventory'))).toBe(true);
      expect(dropStatements.some(h => h.sql.includes('sharedb_terms'))).toBe(true);
      expect(dropStatements.some(h => h.sql.includes('projection_term_tag'))).toBe(true);
    });
  });
});