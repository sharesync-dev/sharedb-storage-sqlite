# Test Inventory for sharedb-storage-sqlite
This document contains all test descriptions to help identify duplicates.

## tests/adapters/attached-sqlite-adapter.test.js
**Describe blocks (5):**
- 📁 AttachedSqliteAdapter
- 📁 Basic Attachment
- 📁 Cross-Database Queries
- 📁 Multiple Attachments
- 📁 Helper Methods

**Test cases (10):**
- ✓ should create adapter with attachment config
- ✓ should throw error without wrapped adapter
- ✓ should throw error without attachment config
- ✓ should connect and attach databases
- ✓ should handle attachment failure gracefully
- ✓ should delegate queries to wrapped adapter
- ✓ should support multiple database attachments
- ✓ should check attachment status
- ✓ should return attached aliases
- ✓ should handle empty attachments

## tests/collection-per-table-basics.test.js
**Describe blocks (1):**
- 📁 CollectionPerTableStrategy Basics

**Test cases (7):**
- ✓ should initialize with default options
- ✓ should create collection tables for configured collections
- ✓ should write and read documents
- ✓ should handle compound IDs correctly
- ✓ should update inventory when writing documents
- ✓ should delete documents and update inventory
- ✓ should create indexes on collection tables

## tests/integration-test.js
**Describe blocks (0):**

**Test cases (0):**

## tests/projection-basics.test.js
**Describe blocks (1):**
- 📁 Projection Basics

**Test cases (7):**
- ✓ should create a projection table during schema initialization
- ✓ should create projection table with correct columns
- ✓ should populate projection table when writing document with array
- ✓ should update projection when document is updated
- ✓ should handle empty array in projection
- ✓ should handle missing array field in projection
- ✓ should handle multiple fields in projection mapping

## tests/schema/default-schema-strategy.test.js
**Describe blocks (10):**
- 📁 DefaultSchemaStrategy
- 📁 initialization
- 📁 initializeSchema
- 📁 getTableName
- 📁 writeRecords
- 📁 readRecord
- 📁 readRecordsBulk
- 📁 deleteRecord
- 📁 inventory management
- 📁 deleteAllTables

**Test cases (25):**
- ✓ should initialize with default options
- ✓ should initialize with encryption options
- ✓ should initialize with schema prefix
- ✓ should initialize with collection mapping
- ✓ should create docs and meta tables
- ✓ should use schema prefix for table names
- ✓ should use collection mapping for table names
- ✓ should return docs table for regular collections
- ✓ should return meta table for __meta__ collection
- ✓ should apply schema prefix
- ✓ should apply collection mapping
- ✓ should write docs records
- ✓ should write meta records
- ✓ should encrypt docs records when encryption is enabled
- ✓ should read a docs record
- ✓ should read a meta record
- ✓ should return null for non-existent record
- ✓ should decrypt encrypted records
- ✓ should read multiple records by ID
- ✓ should return empty array for empty ID list
- ✓ should delete a record
- ✓ should initialize inventory
- ✓ should read inventory
- ✓ should update inventory item
- ✓ should drop all tables

## tests/sql-js-adapter.test.js
**Describe blocks (1):**
- 📁 SqlJsTestAdapter

**Test cases (6):**
- ✓ should create and query tables
- ✓ should handle transactions
- ✓ should support JSON columns
- ✓ should track SQL history
- ✓ should support setTableData helper
- ✓ should handle INSERT OR REPLACE

## tests/storage-tests/architectural-validation.js
**Describe blocks (8):**
- 📁 Architectural Validation - SQLite Storage
- 📁 Interface Compliance
- 📁 Callback Convention Consistency
- 📁 Promise Chain Stress Testing
- 📁 Context Preservation and Async Handling
- 📁 Method Name Collision Detection
- 📁 Schema Strategy Namespace Collision Prevention
- 📁 Edge Case and Error Resilience

**Test cases (13):**
- ✓ should implement all required SqliteStorage methods
- ✓ should implement all required schema strategy methods
- ✓ should use error-first callback convention consistently
- ✓ should handle complex sequential operations without hanging
- ✓ should handle bulk operations with large datasets
- ✓ should preserve context through schema strategy async operations
- ✓ should handle promise chains in db wrapper correctly
- ✓ should not have unexpected method collisions in schema strategies
- ✓ should sanitize collection names properly
- ✓ should prevent user collections from colliding with system tables
- ✓ should handle malformed record data gracefully
- ✓ should handle empty and null inputs gracefully
- ✓ should maintain data consistency under concurrent operations

## tests/storage-tests/attached-strategy-storage-test.js
**Describe blocks (3):**
- 📁 AttachedCollectionPerTableStrategy and SqliteStorage
- 📁 AttachedCollectionPerTableStrategy
- 📁 Automatic Pre-initialization

**Test cases (5):**
- ✓ should initialize schema in attached database
- ✓ should prefix table names correctly
- ✓ should work with SqliteStorage
- ✓ should automatically initialize ShareDB database with indexes before attachment
- ✓ should handle pre-existing initialized databases correctly

## tests/storage-tests/collection-per-table-inventory-test.js
**Describe blocks (1):**
- 📁 CollectionPerTableStrategy Inventory Management

**Test cases (5):**
- ✓ should properly maintain inventory when writing documents
- ✓ should return null for non-existent documents
- ✓ should update inventory when documents are updated
- ✓ should handle bulk reads with inventory lookups
- ✓ should properly clean up inventory when documents are deleted

## tests/storage-tests/debug-inventory-test.js
**Describe blocks (1):**
- 📁 Debug Inventory

**Test cases (1):**
- ✓ should check inventory after write

## tests/storage-tests/default-schema-inventory-test.js
**Describe blocks (1):**
- 📁 DefaultSchemaStrategy Inventory Management

**Test cases (5):**
- ✓ should properly maintain inventory when writing documents
- ✓ should return null for non-existent documents
- ✓ should update inventory when documents are updated
- ✓ should handle bulk reads
- ✓ should properly clean up inventory when documents are deleted

## tests/storage-tests/inventory-strategy-comparison.js
**Describe blocks (5):**
- 📁 Inventory Strategy Comparison
- 📁 Original DurableStore approach (single JSON)
- 📁 DefaultSchemaStrategy approach
- 📁 CollectionPerTableStrategy approach
- 📁 The fundamental mismatch

**Test cases (4):**
- ✓ stores inventory as a single meta document
- ✓ also stores inventory as single JSON in meta table
- ✓ stores inventory as individual rows in sharedb_inventory table
- ✓ highlights the conceptual difference

## tests/storage-tests/simple-write-test.js
**Describe blocks (1):**
- 📁 Simple Write Test

**Test cases (1):**
- ✓ CollectionPerTableStrategy should write without errors

## tests/storage-tests/sqlite-storage-test.js
**Describe blocks (6):**
- 📁 SqliteStorage with BetterSqliteAdapter
- 📁 Basic functionality
- 📁 Schema strategies
- 📁 Encryption support
- 📁 Storage Interface
- 📁 Bug: deleteDatabase with custom schema strategy

**Test cases (8):**
- ✓ should initialize with BetterSqliteAdapter
- ✓ should write and read records
- ✓ should work with CollectionPerTableStrategy with realistic collections
- ✓ should work with DefaultSchemaStrategy
- ✓ should work with CollectionPerTableStrategy
- ✓ should encrypt and decrypt records
- ✓ should have expected storage interface methods
- ✓ should properly delegate deleteDatabase to schema strategy

## tests/storage-tests/version-management-test.js
**Describe blocks (3):**
- 📁 Version Management
- 📁 CollectionPerTableStrategy Version Management
- 📁 DefaultSchemaStrategy with DurableStore-style inventory

**Test cases (7):**
- ✓ should support numeric versions
- ✓ should support string versions (timestamps)
- ✓ should prevent version regression for numeric versions
- ✓ should prevent version regression for string versions
- ✓ should prevent version type mismatch
- ✓ should handle documents with pending operations
- ✓ should store and retrieve versioned documents

---

## Duplicate/Redundant Test Analysis

### 1. **Inventory Management Tests (DUPLICATE)**
These files test essentially the same inventory functionality:
- `tests/storage-tests/collection-per-table-inventory-test.js` (5 tests)
- `tests/storage-tests/default-schema-inventory-test.js` (5 tests)
- `tests/collection-per-table-basics.test.js` includes "update inventory when writing" and "delete documents and update inventory"

**Redundancy:** All test the same basic inventory operations (write, read, update, delete) but for different schema strategies.

### 2. **Write and Read Document Tests (DUPLICATE)**
Multiple files test basic write/read operations:
- `tests/collection-per-table-basics.test.js` - "should write and read documents"
- `tests/storage-tests/sqlite-storage-test.js` - "should write and read records"
- `tests/storage-tests/simple-write-test.js` - "should write without errors"
- `tests/schema/default-schema-strategy.test.js` - "should write docs records", "should read a docs record"

**Redundancy:** Basic CRUD operations tested multiple times across different test files.

### 3. **Schema Strategy Initialization (DUPLICATE)**
Initialization tests appear in multiple places:
- `tests/collection-per-table-basics.test.js` - "should initialize with default options"
- `tests/schema/default-schema-strategy.test.js` - "should initialize with default options"
- `tests/storage-tests/sqlite-storage-test.js` - "should initialize with BetterSqliteAdapter"

**Redundancy:** Testing initialization in both unit tests and integration tests.

### 4. **CollectionPerTableStrategy Tests (PARTIAL DUPLICATE)**
- `tests/collection-per-table-basics.test.js` (7 tests) - newer, cleaner tests
- `tests/storage-tests/collection-per-table-inventory-test.js` (5 tests) - focuses only on inventory
- `tests/storage-tests/sqlite-storage-test.js` - "should work with CollectionPerTableStrategy"

**Redundancy:** Some overlap in testing CollectionPerTableStrategy functionality.

### 5. **Version Management (UNIQUE - Keep)**
- `tests/storage-tests/version-management-test.js` - unique tests for version handling

### 6. **Projections (UNIQUE - Keep)**
- `tests/projection-basics.test.js` - unique projection functionality tests

### 7. **Architectural Validation (UNIQUE - Keep)**
- `tests/storage-tests/architectural-validation.js` - unique architectural constraints tests

### 8. **Debug/Comparison Tests (Consider Removing)**
- `tests/storage-tests/debug-inventory-test.js` - only 1 test, seems like debug code
- `tests/storage-tests/inventory-strategy-comparison.js` - comparison/documentation tests, not functional tests

## Recommendations

### Files to Consider Consolidating/Removing:
1. **Remove `simple-write-test.js`** - Single test covered elsewhere
2. **Remove `debug-inventory-test.js`** - Debug test with only 1 test case
3. **Consider removing `inventory-strategy-comparison.js`** - More documentation than testing
4. **Consolidate inventory tests** - Merge collection-per-table-inventory-test.js into collection-per-table-basics.test.js
5. **Consolidate DefaultSchema inventory tests** - Already well covered in schema/default-schema-strategy.test.js
