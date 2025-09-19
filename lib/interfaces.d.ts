/**
 * GOLDEN TABLET INTERFACES
 *
 * These interfaces define the contract between ShareDB storage strategies
 * and SQLite database adapters. They must be copied VERBATIM to all three
 * packages:
 * - @shaxpir/sharedb-storage-sqlite
 * - @shaxpir/sharedb-storage-node-sqlite
 * - @shaxpir/sharedb-storage-expo-sqlite
 *
 * DO NOT MODIFY these interfaces in individual packages. Any changes must
 * be made here first, then propagated to all packages.
 */

/**
 * Core SQLite adapter interface
 * Provides async methods for database operations
 */
export interface SqliteAdapter {
  /**
   * Connect to the database
   * For file-based: opens the database file
   * For memory-based: initializes the database
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the database
   * Closes connections and frees resources
   */
  disconnect(): Promise<void>;

  /**
   * Execute a SQL statement that modifies data (INSERT, UPDATE, DELETE, CREATE, etc.)
   * @param sql - SQL statement to execute
   * @param params - Optional array of parameters for prepared statement
   * @returns Promise resolving to result object with changes count and lastInsertRowid
   */
  runAsync(sql: string, params?: any[]): Promise<{
    changes: number;
    lastInsertRowid?: number;
  }>;

  /**
   * Execute a SELECT query and return the first row
   * @param sql - SQL SELECT statement
   * @param params - Optional array of parameters for prepared statement
   * @returns Promise resolving to first row as object, or null if no results
   */
  getFirstAsync(sql: string, params?: any[]): Promise<any | null>;

  /**
   * Execute a SELECT query and return all rows
   * @param sql - SQL SELECT statement
   * @param params - Optional array of parameters for prepared statement
   * @returns Promise resolving to array of row objects
   */
  getAllAsync(sql: string, params?: any[]): Promise<any[]>;

  /**
   * Execute a function within a database transaction
   * @param fn - Function containing database operations to run in transaction
   * @returns Result of the transaction function
   */
  transaction<T>(fn: () => T): T;
}

/**
 * Extended adapter interface for database attachment support
 * Allows attaching multiple database files with aliased access
 */
export interface AttachedAdapter extends SqliteAdapter {
  /**
   * Attach an external database file
   * @param path - Path to the database file to attach
   * @param alias - Alias name for accessing the attached database
   * @returns Promise that resolves when attachment is complete
   */
  attachDatabase(path: string, alias: string): Promise<void>;

  /**
   * Detach a previously attached database
   * @param alias - Alias of the database to detach
   * @returns Promise that resolves when detachment is complete
   */
  detachDatabase(alias: string): Promise<void>;

  /**
   * Check if a database is currently attached
   * @param alias - Alias to check
   * @returns true if the database is attached, false otherwise
   */
  isAttached(alias: string): boolean;

  /**
   * Get list of all currently attached database aliases
   * @returns Array of alias strings
   */
  getAttachedAliases(): string[];
}

/**
 * Configuration for attaching databases
 */
export interface AttachmentConfig {
  /** Path to the database file */
  path: string;
  /** Alias for accessing the attached database */
  alias: string;
  /** Optional: Create file if it doesn't exist (default: false) */
  createIfNotExists?: boolean;
}

/**
 * Options for creating attached adapters
 */
export interface AttachedAdapterOptions {
  /** Array of databases to attach on connection */
  attachments: AttachmentConfig[];
}