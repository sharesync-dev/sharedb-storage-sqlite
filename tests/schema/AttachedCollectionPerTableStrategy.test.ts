/**
 * Tests for AttachedCollectionPerTableStrategy
 */

import { AttachedCollectionPerTableStrategy } from '../../src/schema/AttachedCollectionPerTableStrategy';
import { MockDatabase } from '../mocks/MockDatabase';
import { SchemaStrategyOptions } from '../../src/schema/BaseSchemaStrategy';

describe('AttachedCollectionPerTableStrategy', () => {
  let strategy: AttachedCollectionPerTableStrategy;
  let db: MockDatabase;

  beforeEach(() => {
    db = new MockDatabase();
  });

  describe('initialization', () => {
    it('should initialize with default options', () => {
      strategy = new AttachedCollectionPerTableStrategy();
      expect(strategy).toBeDefined();
      expect(strategy.getInventoryType()).toBe('inventory');
    });

    it('should inherit from CollectionPerTableStrategy', () => {
      strategy = new AttachedCollectionPerTableStrategy();
      expect(strategy).toBeInstanceOf(AttachedCollectionPerTableStrategy);
      expect(strategy.getTableName('terms')).toBe('sharedb_terms');
    });
  });

  describe('initializeSchema', () => {
    beforeEach(() => {
      strategy = new AttachedCollectionPerTableStrategy({
        collectionConfig: {
          terms: {
            indexes: ['payload.term']
          }
        }
      });
    });

    it('should create tables in main database without ATTACH', async () => {
      await strategy.initializeSchema(db);

      const history = db.getSqlHistory();

      // Should NOT have any ATTACH DATABASE statements
      expect(history.some(h => h.sql.includes('ATTACH DATABASE'))).toBe(false);

      // Should create tables directly
      const createStatements = history.filter(h => h.sql.includes('CREATE TABLE'));
      expect(createStatements.some(h => h.sql.includes('sharedb_meta'))).toBe(true);
      expect(createStatements.some(h => h.sql.includes('sharedb_inventory'))).toBe(true);
      expect(createStatements.some(h => h.sql.includes('sharedb_terms'))).toBe(true);
    });

    it('should create indexes in main database', async () => {
      await strategy.initializeSchema(db);

      const history = db.getSqlHistory();
      const indexStatements = history.filter(h => h.sql.includes('CREATE INDEX'));

      expect(indexStatements.some(h => h.sql.includes('idx_inventory_collection'))).toBe(true);
      expect(indexStatements.some(h => h.sql.includes('idx_inventory_updated'))).toBe(true);
    });
  });

  describe('validateSchema', () => {
    beforeEach(() => {
      strategy = new AttachedCollectionPerTableStrategy();
    });

    it('should check tables in main database', async () => {
      await strategy.initializeSchema(db);

      // Mock the tables existence
      db.setTableData('sharedb_meta', []);
      db.setTableData('sharedb_inventory', []);

      const isValid = await strategy.validateSchema(db);

      const history = db.getSqlHistory();
      const selectStatements = history.filter(h => h.sql.includes('sqlite_master'));

      // Should query main database's sqlite_master
      expect(selectStatements.length).toBeGreaterThan(0);
      expect(selectStatements.some(h => !h.sql.includes('.'))).toBe(true);

      expect(isValid).toBe(true);
    });
  });

  describe('deleteAllTables', () => {
    beforeEach(() => {
      strategy = new AttachedCollectionPerTableStrategy({
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

    it('should drop tables from main database', async () => {
      await strategy.initializeSchema(db);

      // Mock some tables
      db.setTableData('sharedb_meta', []);
      db.setTableData('sharedb_inventory', []);
      db.setTableData('sharedb_terms', []);
      db.setTableData('projection_term_tag', []);

      await strategy.deleteAllTables(db);

      const history = db.getSqlHistory();

      // Should query main database for tables
      const selectStatements = history.filter(h =>
        h.sql.includes('sqlite_master') && h.sql.includes('sharedb_')
      );
      expect(selectStatements.length).toBeGreaterThan(0);

      // Should drop tables without database prefix
      const dropStatements = history.filter(h => h.sql.includes('DROP TABLE'));
      expect(dropStatements.length).toBeGreaterThan(0);
      expect(dropStatements.every(h => !h.sql.includes('.'))).toBe(true);
    });
  });

  describe('projection support', () => {
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
      strategy = new AttachedCollectionPerTableStrategy(options);
    });

    it('should inherit projection functionality from parent', async () => {
      await strategy.initializeSchema(db);

      const record = {
        id: 'term-1',
        collection: 'terms',
        payload: {
          tags: ['chinese', 'hsk1']
        }
      };

      await strategy.writeRecords(db, {
        docs: {
          terms: [record]
        }
      });

      const history = db.getSqlHistory();

      // Should create projection table
      const createProjection = history.filter(h =>
        h.sql.includes('CREATE TABLE') && h.sql.includes('projection_term_tag')
      );


      expect(createProjection.length).toBe(1);

      // Should insert projections
      const insertProjections = history.filter(h =>
        h.sql.includes('INSERT') && h.sql.includes('projection_term_tag')
      );
      expect(insertProjections.length).toBe(2); // One for each tag
    });
  });

  describe('operations should work in single database', () => {
    beforeEach(() => {
      strategy = new AttachedCollectionPerTableStrategy();
    });

    it('should write and read records correctly', async () => {
      await strategy.initializeSchema(db);

      // Write a record
      const record = {
        id: 'doc-1',
        collection: 'terms',
        version: 1,
        payload: { term: 'hello' }
      };

      await strategy.writeRecords(db, {
        docs: {
          terms: [record]
        }
      });

      // Mock the data
      db.setTableData('sharedb_terms', [
        { id: 'doc-1', data: JSON.stringify(record) }
      ]);

      // Read it back
      const readRecord = await strategy.readRecord(db, 'docs', 'terms', 'doc-1');

      expect(readRecord).toBeDefined();
      expect(readRecord?.id).toBe('doc-1');
      expect(readRecord?.payload).toEqual({ term: 'hello' });
    });

    it('should handle inventory operations', async () => {
      await strategy.initializeSchema(db);

      // Update inventory
      await strategy.updateInventoryItem(db, 'terms', 'doc-1', 5, 'update');

      const history = db.getSqlHistory();
      const inventoryUpdates = history.filter(h =>
        h.sql.includes('INSERT OR REPLACE INTO sharedb_inventory')
      );

      expect(inventoryUpdates.length).toBe(1);
      expect(inventoryUpdates[0].params).toContain('doc-1');
      expect(inventoryUpdates[0].params).toContain('terms');
      expect(inventoryUpdates[0].params).toContain(5);
    });
  });
});