# Test Coverage Inventory

## CollectionPerTableStrategy Tests (tests/schema/collection-per-table-strategy.test.js)
Currently 35 failing tests that rely on mock-specific methods.

### Core Functionality Tests:
1. **Initialization**
   - ✅ Initialize with default options
   - ✅ Initialize with collection config

2. **Schema Management**
   - ✅ Create inventory table
   - ✅ Create collection tables for configured collections
   - ✅ Create indexes on inventory table

3. **Projections**
   - ✅ Create projection tables
   - ✅ Create indexes on projection tables
   - ✅ Handle @element and source in projection mappings
   - ✅ Populate projection when writing document with array
   - ✅ Handle empty array in document
   - ✅ Handle missing array field in document
   - ✅ Update projection when document is updated
   - ✅ Handle paths with dots correctly
   - ✅ Handle special @element mapping

4. **CRUD Operations**
   - ✅ Write document records
   - ✅ Update inventory when writing records
   - ✅ Return null for non-existent record
   - ✅ Read record with compound ID correctly
   - ✅ Handle compound ID with special characters
   - ✅ Delete a record
   - ✅ Remove from inventory when deleting
   - ✅ Delete record with compound ID correctly

5. **Inventory Management**
   - ✅ Read empty inventory
   - ✅ Update inventory item
   - ✅ Write inventory from meta using INSERT OR REPLACE
   - ✅ Preserve existing inventory when writing from meta

## AttachedCollectionPerTableStrategy Tests (tests/schema/attached-collection-per-table-strategy.test.js)
Currently failing due to mock dependencies.

### Core Functionality Tests:
1. **Initialization & Inheritance**
   - ✅ Initialize with default options
   - ✅ Initialize with collection config
   - ✅ Inherit from CollectionPerTableStrategy
   - ✅ Use CollectionPerTableStrategy projection features

2. **Schema Management**
   - ✅ Create inventory table in main database
   - ✅ Create collection tables in main database
   - ✅ Use different inventory schema than base class
   - ✅ Validate schema exists
   - ✅ Return false for missing tables
   - ✅ Delete all ShareDB tables
   - ✅ Clear created tables tracking

3. **Attachment & Projections**
   - ✅ Create projection tables with attachment alias prefix
   - ✅ Handle projection table creation without attachment alias
   - ✅ Insert projection data when writing record with array
   - ✅ Delete old projections before inserting new ones on update
   - ✅ Handle empty arrays in projections
   - ✅ Handle missing array field in projections
   - ✅ Correctly resolve complex paths with attachment alias

## Coverage in storage-tests/ Directory

### collection-per-table-inventory-test.js
- Inventory management with collection-per-table strategy
- Complex collection scenarios with different configurations
- Inventory synchronization across collections

### attached-strategy-storage-test.js
- AttachedCollectionPerTableStrategy with SqliteStorage
- Schema initialization in attached database
- Automatic pre-initialization with indexes
- Handling pre-existing initialized databases

### inventory-strategy-comparison.js
- Comparison between different inventory strategies
- Migration between strategies

### default-schema-inventory-test.js
- DefaultSchemaStrategy inventory operations
- JSON-based inventory management

### sqlite-storage-test.js
- Basic SqliteStorage functionality with BetterSqliteAdapter
- Schema strategy integration
- Encryption support
- Storage interface compliance
- Bug: deleteDatabase with custom schema strategy

### simple-write-test.js
- Basic write/read operations
- Compound key handling

### version-management-test.js
- Version tracking and management
- Concurrent version updates

### architectural-validation.js
- Architectural constraints validation
- Dependency structure verification

### debug-inventory-test.js
- Debugging utilities for inventory issues
- Error handling and recovery

## Coverage Analysis

### Well Covered:
✅ Basic CRUD operations (write, read, delete)
✅ Inventory management (both JSON and table-based)
✅ Compound key handling
✅ Schema initialization
✅ Encryption support
✅ Storage interface compliance

### Potentially Missing Coverage:
❓ Projection table SQL generation details (currently tested via mock SQL history)
❓ Index creation SQL specifics (currently tested via mock SQL history)
❓ Transaction handling details
❓ Error conditions during schema operations

### Duplicate Coverage:
- Inventory management is tested in multiple places:
  - collection-per-table-inventory-test.js
  - inventory-strategy-comparison.js
  - default-schema-inventory-test.js
  - Within the schema strategy tests themselves

- Basic CRUD operations tested in:
  - sqlite-storage-test.js
  - simple-write-test.js
  - Within the schema strategy tests

## Recommendations

1. **Keep from schema tests:**
   - Projection functionality tests (unique to CollectionPerTableStrategy)
   - Attachment alias tests (unique to AttachedCollectionPerTableStrategy)
   - Schema prefix tests
   - Collection mapping tests

2. **Already covered elsewhere:**
   - Basic CRUD operations (covered in storage-tests/)
   - Inventory management (extensively covered in storage-tests/)
   - Basic initialization (covered in multiple places)

3. **Consider removing:**
   - Tests that only verify SQL syntax/history
   - Tests that duplicate basic CRUD coverage
   - Tests that check implementation details rather than behavior

4. **Convert to behavior tests:**
   - Instead of checking SQL history, verify actual database state
   - Test that indexes improve query performance
   - Test that projections are queryable and contain correct data