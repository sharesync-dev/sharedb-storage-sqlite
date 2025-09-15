/**
 * Simple integration test to verify the library works
 */

import { CollectionPerTableStrategy } from '../src/schema/CollectionPerTableStrategy';
import { AttachedCollectionPerTableStrategy } from '../src/schema/AttachedCollectionPerTableStrategy';

// Simple mock database for testing
class SimpleDB {
  private tables: Map<string, any[]> = new Map();

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async runAsync(sql: string, params?: any[]): Promise<any> {
    console.log('SQL:', sql.substring(0, 50) + '...', params?.slice(0, 2));
    return { changes: 1 };
  }

  async getFirstAsync(sql: string, params?: any[]): Promise<any> {
    console.log('GET:', sql.substring(0, 50) + '...', params?.slice(0, 2));
    return null;
  }

  async getAllAsync(sql: string, params?: any[]): Promise<any[]> {
    console.log('ALL:', sql.substring(0, 50) + '...', params?.slice(0, 2));
    return [];
  }
}

async function test() {
  console.log('Testing CollectionPerTableStrategy...');

  const strategy = new CollectionPerTableStrategy({
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
  });

  const db = new SimpleDB() as any;

  // Initialize schema
  console.log('\nInitializing schema...');
  await strategy.initializeSchema(db);

  // Write a record
  console.log('\nWriting record...');
  await strategy.writeRecords(db, {
    docs: {
      terms: [
        {
          id: 'term-1',
          collection: 'terms',
          payload: {
            term: 'hello',
            tags: ['english', 'greeting']
          }
        }
      ]
    }
  });

  console.log('\nTesting AttachedCollectionPerTableStrategy...');
  const attachedStrategy = new AttachedCollectionPerTableStrategy({
    collectionConfig: {
      terms: {
        indexes: ['payload.term']
      }
    }
  });

  await attachedStrategy.initializeSchema(db);

  console.log('\n✅ Integration test passed!');
}

test().catch(console.error);