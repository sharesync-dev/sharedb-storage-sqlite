/**
 * Mock database implementation for testing
 */

import { DatabaseConnection } from '../../src/schema/BaseSchemaStrategy';

export class MockDatabase implements DatabaseConnection {
  private data: Map<string, any[]> = new Map();
  private sqlHistory: Array<{ sql: string; params?: any[] }> = [];

  constructor() {
    this.reset();
  }

  async transaction<T>(operations: () => Promise<T>): Promise<T> {
    // Simple mock transaction - just execute the operations
    return await operations();
  }

  reset() {
    this.data.clear();
    this.sqlHistory = [];
  }

  getSqlHistory() {
    return this.sqlHistory;
  }

  async runAsync(sql: string, params?: any[]): Promise<any> {
    this.sqlHistory.push({ sql, params });

    // Simple SQL parsing for testing
    const upperSql = sql.trim().toUpperCase();

    if (upperSql.startsWith('CREATE TABLE')) {
      const tableName = this.extractTableName(sql);
      if (tableName && !this.data.has(tableName)) {
        this.data.set(tableName, []);
      }
      return { changes: 0 };
    }

    if (upperSql.startsWith('INSERT')) {
      const tableName = this.extractTableName(sql);
      if (tableName) {
        const table = this.data.get(tableName) || [];
        const record = this.createRecordFromParams(params || []);
        table.push(record);
        this.data.set(tableName, table);
        return { changes: 1, lastInsertRowid: table.length };
      }
    }

    if (upperSql.startsWith('DELETE')) {
      const tableName = this.extractTableName(sql);
      if (tableName) {
        const table = this.data.get(tableName) || [];
        // Simple deletion - just clear for testing
        this.data.set(tableName, []);
        return { changes: table.length };
      }
    }

    if (upperSql.startsWith('DROP TABLE')) {
      const tableName = this.extractTableName(sql);
      if (tableName) {
        this.data.delete(tableName);
        return { changes: 0 };
      }
    }

    return { changes: 0 };
  }

  async getFirstAsync(sql: string, params?: any[]): Promise<any> {
    this.sqlHistory.push({ sql, params });

    const tableName = this.extractTableName(sql);
    if (tableName) {
      const table = this.data.get(tableName) || [];
      if (table.length > 0) {
        return table[0];
      }
    }

    // Mock some specific queries for testing
    if (sql.includes('sqlite_master')) {
      if (sql.includes("name='sharedb_meta'")) {
        return this.data.has('sharedb_meta') ? { name: 'sharedb_meta' } : null;
      }
      if (sql.includes("name='sharedb_inventory'")) {
        return this.data.has('sharedb_inventory') ? { name: 'sharedb_inventory' } : null;
      }
    }

    return null;
  }

  async getAllAsync(sql: string, params?: any[]): Promise<any[]> {
    this.sqlHistory.push({ sql, params });

    const tableName = this.extractTableName(sql);
    if (tableName) {
      return this.data.get(tableName) || [];
    }

    // Mock getting all tables
    if (sql.includes('sqlite_master')) {
      const tables: any[] = [];
      for (const [name, _] of this.data) {
        if (name.startsWith('sharedb_') || name.startsWith('projection_')) {
          tables.push({ name });
        }
      }
      return tables;
    }

    return [];
  }

  private extractTableName(sql: string): string | null {
    const patterns = [
      /FROM\s+(\w+)/i,
      /INTO\s+(\w+)/i,
      /TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i,
      /TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/i,
      /UPDATE\s+(\w+)/i
    ];

    for (const pattern of patterns) {
      const match = sql.match(pattern);
      if (match) {
        return match[1].toLowerCase();
      }
    }

    return null;
  }

  private createRecordFromParams(params: any[]): any {
    // Simple mock record creation
    return {
      id: params[0] || 'test-id',
      data: params[1] || '{}',
      collection: params[2] || 'test',
      version: params[3] || 1
    };
  }

  // Additional helper methods for testing
  hasTable(tableName: string): boolean {
    return this.data.has(tableName);
  }

  getTableData(tableName: string): any[] {
    return this.data.get(tableName) || [];
  }

  setTableData(tableName: string, data: any[]): void {
    this.data.set(tableName, data);
  }
}