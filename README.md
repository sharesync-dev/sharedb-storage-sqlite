# @shaxpir/sharedb-storage-sqlite

Shared SQLite storage components for ShareDB adapters. This library provides the core schema strategies and base classes used by both Node.js and React Native SQLite storage implementations.

## Overview

This package contains the shared components for SQLite-based ShareDB storage:

- **Schema Strategies**: Define how ShareDB documents are organized in SQLite tables
- **Base Classes**: Core SQLite storage implementation that works with any SQLite adapter
- **Adapters**: AttachedSqliteAdapter for multi-database support
- **Interfaces**: TypeScript definitions for SQLite adapters and storage options
- **Utilities**: JsonPathValidator for SQL query validation
- **Projection Support**: Automatic materialization of JSON arrays into relational tables for optimized queries

## Performance

Relational projections provide dramatic performance improvements for array field queries:

- **180x faster** tag filtering (23s → 107ms for 100k records)
- **No JSON parsing** in hot query paths
- **Standard SQL indexes** on projected data
- **Automatic synchronization** on every write

## Installation

```bash
npm install @shaxpir/sharedb-storage-sqlite
```

Note: This is a shared library. For actual usage, install one of:
- `@shaxpir/sharedb-storage-node-sqlite` for Node.js applications
- `@shaxpir/sharedb-storage-expo-sqlite` for React Native applications

## Features

### Schema Strategies

#### CollectionPerTableStrategy
Creates a separate table for each ShareDB collection with:
- Collection-specific indexes on JSON fields
- Field-level encryption support
- Automatic projection tables for array fields
- Optimized bulk operations

#### AttachedCollectionPerTableStrategy
Extends CollectionPerTableStrategy for multi-database setups:
- Attach multiple SQLite databases
- Cross-database queries
- Automatic prefixing for attached tables

### Projections

The library supports automatic projection of JSON array fields into relational tables:

```typescript
const config = {
  term: {
    indexes: ['payload.data.payload.text'],
    encryptedFields: [],
    projections: [{
      type: 'array_expansion',
      targetTable: 'term_tag',
      mapping: {
        'term_id': 'id',
        'tag': ''  // Empty string means array element itself
      },
      arrayPath: 'payload.data.payload.tags',
      primaryKey: ['term_id', 'tag']
    }]
  }
};
```

This automatically maintains a `term_tag` table that mirrors the tags array, enabling efficient SQL queries without JSON parsing.

## Architecture

```
@shaxpir/sharedb-storage-sqlite (this package)
├── Schema Strategies (CollectionPerTableStrategy, etc.)
├── Base Classes (SqliteStorage)
└── Interfaces (SqliteAdapter, SchemaStrategy, etc.)
    ↓
@shaxpir/sharedb-storage-node-sqlite
├── Node.js SQLite Adapter (better-sqlite3)
└── Uses shared components
    ↓
@shaxpir/sharedb-storage-expo-sqlite
├── React Native SQLite Adapter (expo-sqlite)
└── Uses shared components
```

## API

### SqliteStorage

Base class implementing ShareDB's `DurableStorage` interface:

```typescript
class SqliteStorage implements DurableStorage {
  constructor(options: SqliteStorageOptions);
  initialize(callback: DurableStorageCallback): void;
  readRecord(storeName: string, id: string, callback: DurableStorageCallback<any>): void;
  writeRecords(records: DurableStorageRecords, callback: DurableStorageCallback): void;
  // ... other DurableStorage methods
}
```

### SchemaStrategy

Interface for defining how data is organized in SQLite:

```typescript
interface SchemaStrategy {
  initializeSchema(db: SqliteConnection, callback?: DurableStorageCallback): Promise<void>;
  writeRecords(db: SqliteConnection, recordsByType: DurableStorageRecords, callback?: DurableStorageCallback): Promise<void>;
  readRecord(db: SqliteConnection, type: string, collection: string | null, id: string, callback?: DurableStorageCallback<DurableStorageRecord | null>): Promise<DurableStorageRecord | null>;
  // ... other methods
}
```

### SqliteAdapter

Platform-specific SQLite implementations must implement this interface:

```typescript
interface SqliteAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  runAsync(sql: string, params?: any[]): Promise<any>;
  getFirstAsync(sql: string, params?: any[]): Promise<any>;
  getAllAsync(sql: string, params?: any[]): Promise<any[]>;
  transaction?<T>(operations: () => Promise<T>): Promise<T>;
}
```

### AttachedSqliteAdapter

Decorator adapter that adds database attachment support:

```typescript
class AttachedSqliteAdapter {
  constructor(wrappedAdapter: SqliteAdapter, attachmentConfig: AttachedSqliteAdapterConfig, debug?: boolean);
  isAttached(): boolean;
  getAttachedAliases(): string[];
}
```

### JsonPathValidator

Utility for validating JSON path expressions in SQL queries:

```typescript
class JsonPathValidator {
  static validateJsonPaths(sql: string): string;
}
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Watch mode
npm run watch
```

## Contributing

This is a shared library used by multiple ShareDB storage adapters. Changes here will affect both Node.js and React Native implementations. Please ensure backward compatibility.

## License

MIT

## Related Packages

- [@shaxpir/sharedb](https://github.com/shaxpir/sharedb) - ShareDB fork with DurableStore support
- [@shaxpir/sharedb-storage-node-sqlite](https://github.com/shaxpir/sharedb-storage-node-sqlite) - Node.js implementation
- [@shaxpir/sharedb-storage-expo-sqlite](https://github.com/shaxpir/sharedb-storage-expo-sqlite) - React Native implementation