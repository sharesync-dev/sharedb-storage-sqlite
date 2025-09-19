# Unique Features in Failing Tests

## Critical Features NOT Tested Elsewhere

### 1. **Projections** (CollectionPerTableStrategy)
**Not tested anywhere else in the codebase!**

Projections are a powerful feature that creates separate tables for array fields, enabling efficient queries on nested data. The failing tests cover:

- Creating projection tables for array fields
- Creating indexes on projection tables
- Handling `@element` special mapping for array elements
- Updating projections when documents change
- Handling empty arrays and missing fields
- Complex path resolution in projections
- Source field mapping in projections

**Example Use Case:**
If a document has `tags: ['javascript', 'nodejs']`, projections create a separate `document_tags` table with rows for each tag, enabling efficient tag-based queries.

### 2. **SQL Generation Verification**
The failing tests verify that:
- Correct tables are created with proper schema
- Indexes are created on the right columns
- INSERT/UPDATE/DELETE statements use correct syntax
- Transactions are used appropriately

While we can test outcomes, these tests verify the HOW, which can catch:
- Performance issues (missing indexes)
- SQL injection vulnerabilities
- Database compatibility issues

## Features Already Tested Elsewhere

### 1. **Basic CRUD Operations**
- ✅ Covered in: sqlite-storage-test.js, simple-write-test.js
- Write, read, update, delete documents
- Compound key handling

### 2. **Inventory Management**
- ✅ Covered in: collection-per-table-inventory-test.js, inventory-strategy-comparison.js, default-schema-inventory-test.js
- Reading/writing inventory
- Updating inventory on document changes
- Different inventory strategies (JSON vs table)

### 3. **Attachment/Database Separation**
- ✅ Covered in: attached-strategy-storage-test.js
- Creating tables in attached databases
- Schema initialization with attachment alias
- Pre-initialization of attached databases

### 4. **Schema Initialization**
- ✅ Covered in: Multiple storage tests
- Creating initial tables
- Setting up indexes
- Validating schema

## Recommendation

### Must Preserve (No Other Coverage):
1. **All projection tests** - This functionality is completely untested elsewhere
2. **Index creation verification** - Important for performance

### Can Remove (Duplicate Coverage):
1. Basic CRUD operation tests
2. Simple inventory management tests
3. Basic initialization tests

### Should Refactor (Important but Mock-Dependent):
1. Convert projection tests to use real SQLite
2. Verify indexes exist by querying sqlite_master
3. Test projection queries actually work efficiently

## Migration Strategy

For the projection tests specifically, we should:

1. **Create a new test file**: `tests/projections.test.js`
2. **Test with real SQLite**:
   - Create documents with array fields
   - Verify projection tables are created
   - Query projection tables to verify data
   - Test projection updates when documents change
   - Measure query performance with/without projections

3. **Keep behavioral focus**:
   - Don't test SQL strings
   - Test that queries return correct results
   - Test that performance improves with projections
   - Test edge cases (empty arrays, missing fields)