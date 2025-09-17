/**
 * JsonPath validator for ShareDB SQLite storage implementations.
 * 
 * ShareDB DurableStore with CollectionPerTableStrategy stores documents with nested structure:
 * - Table columns: id, collection, data (JSON)
 * - The 'data' column contains:
 *   {
 *     id: "collection/docId",
 *     payload: {
 *       collection: "term",
 *       id: "docId",
 *       version: 1,
 *       data: {
 *         meta: { ... },      // Document metadata
 *         payload: { ... }    // Actual application data
 *       },
 *       pendingOps: [],
 *       inflightOp: null,
 *       ...
 *     }
 *   }
 * 
 * This validator ensures that JsonPath expressions used in SQL queries
 * follow the correct nested structure.
 */

// Logger is optional - will use console if not available
let logger;
try {
  logger = require('../logger');
} catch (e) {
  // Fallback to console if logger module doesn't exist
  logger = {
    warn: function(message) {
      console.warn(message);
    }
  };
}

/**
 * List of SQLite JSON functions that accept JsonPath as an argument
 */
const JSON_FUNCTIONS = [
  'json_extract',
  'json_array_length',
  'json_type',
  'json_valid',
  'json_quote',
  'json_remove',
  'json_replace',
  'json_set',
  'json_insert',
  'json_array',
  'json_object',
  'json_patch',
  'json_each',
  'json_tree'
];

/**
 * Validates JsonPath expressions in a SQL query for ShareDB storage.
 * 
 * @param {string} sql - The SQL query to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.throwOnError - Whether to throw an error on invalid paths (default: false)
 * @param {boolean} options.logWarnings - Whether to log warnings for invalid paths (default: true)
 * @returns {Object} Validation result with { isValid: boolean, errors: string[] }
 */
function validateJsonPaths(sql, options) {
  options = options || {};
  const throwOnError = options.throwOnError || false;
  const logWarnings = options.logWarnings !== false; // Default to true
  
  const errors = [];
  
  // Create a regex pattern that matches any JSON function with a JsonPath argument
  const functionPattern = `(?:${JSON_FUNCTIONS.join('|')})`;
  const jsonPathPattern = new RegExp(
    `${functionPattern}\\s*\\(\\s*[^,]+,\\s*['"](\\\$[^'"]+)['"]`,
    'gi'
  );
  
  const matches = sql.matchAll(jsonPathPattern);
  
  for (const match of matches) {
    const jsonPath = match[1];
    
    // Allow simple column references for ShareDB metadata
    const isShareDBMetadata = jsonPath.match(/^\$\.payload\.(collection|id|version|type_name|pendingOps|inflightOp)$/);
    
    // Check for correct document data paths
    const isCorrectDocPath = jsonPath.startsWith('$.payload.data.payload') || 
                             jsonPath.startsWith('$.payload.data.meta');
    
    // Also allow direct column access without nested structure for non-ShareDB tables
    const isSimpleColumnPath = jsonPath.match(/^\$\.[a-zA-Z_][a-zA-Z0-9_]*$/);
    
    if (!isShareDBMetadata && !isCorrectDocPath && !isSimpleColumnPath) {
      const errorMsg = `Incorrect JsonPath in ShareDB query: "${jsonPath}"`;
      const expectedMsg = `Expected: $.payload.data.payload.* or $.payload.data.meta.*`;
      errors.push(`${errorMsg} - ${expectedMsg}`);
      
      if (logWarnings) {
        logger.warn(`⚠️ [JsonPathValidator] ${errorMsg}`);
        logger.warn(`   ${expectedMsg}`);
        logger.warn(`   Query: ${sql.substring(0, 200)}${sql.length > 200 ? '...' : ''}`);
      }
      
      if (throwOnError) {
        throw new Error(`Invalid JsonPath for ShareDB query: ${jsonPath}`);
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Creates a SQL query executor that validates JsonPath expressions.
 * This is a wrapper function that can be used to wrap database query methods.
 * 
 * @param {Function} executeQuery - The original query execution function
 * @param {Object} options - Validation options (same as validateJsonPaths)
 * @returns {Function} A wrapped query executor that validates before executing
 */
function createValidatedQueryExecutor(executeQuery, options) {
  return async function(sql, params) {
    // Validate the query
    const validation = validateJsonPaths(sql, options);
    
    // Execute the original query
    return executeQuery.call(this, sql, params);
  };
}

/**
 * Fixes common JsonPath mistakes in queries.
 * This can help migrate queries from incorrect to correct paths.
 * 
 * @param {string} sql - The SQL query to fix
 * @returns {string} The fixed SQL query
 */
function fixCommonJsonPathMistakes(sql) {
  // Fix paths that go directly to payload without the nested structure
  // e.g., $.payload.tags -> $.payload.data.payload.tags
  sql = sql.replace(
    /json_extract\s*\(\s*([^,]+),\s*['"]\$\.payload\.(?!data\.)([^'"]+)['"]/gi,
    "json_extract($1, '$.payload.data.payload.$2'"
  );
  
  return sql;
}

module.exports = {
  validateJsonPaths,
  createValidatedQueryExecutor,
  fixCommonJsonPathMistakes,
  JSON_FUNCTIONS
};