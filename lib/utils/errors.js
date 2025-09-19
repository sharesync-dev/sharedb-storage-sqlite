/**
 * Error utilities for ShareDB-compatible error handling
 */

/**
 * Error codes for ShareDB SQLite Storage
 * These align with ShareDB's error code conventions
 */
var ERROR_CODES = {
  // General errors (1xxx)
  UNKNOWN: 1000,
  NOT_INITIALIZED: 1001,
  ALREADY_INITIALIZED: 1002,

  // Database errors (2xxx)
  DB_CONNECTION_FAILED: 2001,
  DB_QUERY_FAILED: 2002,
  DB_TRANSACTION_FAILED: 2003,

  // Schema errors (3xxx)
  SCHEMA_INIT_FAILED: 3001,
  SCHEMA_MIGRATION_FAILED: 3002,
  INVALID_SCHEMA_STRATEGY: 3003,

  // Storage operation errors (4xxx)
  RECORD_NOT_FOUND: 4001,
  WRITE_FAILED: 4002,
  DELETE_FAILED: 4003,
  CLEAR_FAILED: 4004,
  BULK_READ_FAILED: 4005,

  // Adapter errors (5xxx)
  NO_ADAPTER: 5001,
  ADAPTER_NOT_CONNECTED: 5002,
  INVALID_ADAPTER: 5003
};

/**
 * Creates a ShareDB-compatible error with a code
 * @param {string} message - Error message
 * @param {number} code - Error code (from ERROR_CODES)
 * @param {Error} [originalError] - Original error if wrapping
 * @returns {Error} Error object with code property
 */
function createShareDBError(message, code, originalError) {
  var error = new Error(message);
  error.code = code || ERROR_CODES.UNKNOWN;

  // Preserve original error details if provided
  if (originalError) {
    error.originalError = originalError;
    if (originalError.stack) {
      error.stack = originalError.stack;
    }
  }

  return error;
}

/**
 * Wraps a standard error into a ShareDB-compatible error
 * @param {Error} error - Standard error to wrap
 * @param {number} [code] - Error code to assign
 * @returns {Error} ShareDB-compatible error
 */
function wrapError(error, code) {
  if (error && typeof error.code === 'number') {
    // Already a ShareDB error
    return error;
  }

  var message = error ? (error.message || String(error)) : 'Unknown error';
  return createShareDBError(message, code || ERROR_CODES.UNKNOWN, error);
}

/**
 * Ensures callback errors are ShareDB-compatible
 * @param {Function} callback - Original callback
 * @param {number} [defaultCode] - Default error code if error lacks one
 * @returns {Function} Wrapped callback
 */
function wrapCallback(callback, defaultCode) {
  return function(error, result) {
    if (error && typeof error.code !== 'number') {
      error = wrapError(error, defaultCode);
    }
    callback(error, result);
  };
}

module.exports = {
  ERROR_CODES: ERROR_CODES,
  createShareDBError: createShareDBError,
  wrapError: wrapError,
  wrapCallback: wrapCallback
};