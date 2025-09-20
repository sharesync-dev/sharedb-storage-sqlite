/**
 * Format validation utilities for ShareDB storage
 *
 * ShareDB uses compound keys in the format: "collection/docId"
 * - Collection names must not contain slashes
 * - Document IDs must not contain slashes
 * - Compound keys must have exactly one slash separating collection and docId
 *
 * All methods return their input if valid, or throw an error if invalid.
 */

var Formatted = {
  /**
   * Validates and returns a compound key (collection/docId format)
   * @param {string} str - The string to validate as a compound key
   * @returns {string} The input string if valid
   * @throws {Error} If not a valid compound key
   */
  asCompoundKey: function(str) {
    if (!str) {
      throw new Error('Compound key cannot be empty');
    }

    var firstSlash = str.indexOf('/');
    if (firstSlash === -1) {
      throw new Error('Compound key must contain a slash separating collection and document ID. Got: "' + str + '"');
    }
    if (firstSlash === 0) {
      throw new Error('Compound key cannot start with a slash. Got: "' + str + '"');
    }
    if (firstSlash === str.length - 1) {
      throw new Error('Compound key cannot end with a slash. Got: "' + str + '"');
    }

    var docId = str.substring(firstSlash + 1);
    if (docId.indexOf('/') !== -1) {
      throw new Error('Document ID part of compound key cannot contain slashes. Got: "' + str +
        '" where document ID "' + docId + '" contains slashes');
    }

    return str;
  },

  /**
   * Validates and returns a collection name (no slashes)
   * @param {string} str - The string to validate as a collection name
   * @returns {string} The input string if valid
   * @throws {Error} If not a valid collection name
   */
  asCollectionName: function(str) {
    if (!str) {
      throw new Error('Collection name cannot be empty');
    }
    if (str.indexOf('/') !== -1) {
      throw new Error('Collection name cannot contain slashes. Got: "' + str + '"');
    }
    return str;
  },

  /**
   * Validates and returns a document ID (no slashes)
   * @param {string} str - The string to validate as a document ID
   * @returns {string} The input string if valid
   * @throws {Error} If not a valid document ID
   */
  asDocId: function(str) {
    if (!str) {
      throw new Error('Document ID cannot be empty');
    }
    if (str.indexOf('/') !== -1) {
      throw new Error('Document ID cannot contain slashes. Got: "' + str + '"');
    }
    return str;
  },

  /**
   * Splits a compound key into its components
   * @param {string} compoundKey - The compound key to split
   * @returns {{collection: string, docId: string}} The components
   * @throws {Error} If not a valid compound key
   */
  split: function(compoundKey) {
    // First validate it's a proper compound key
    this.asCompoundKey(compoundKey);

    var firstSlash = compoundKey.indexOf('/');
    return {
      collection: compoundKey.substring(0, firstSlash),
      docId: compoundKey.substring(firstSlash + 1)
    };
  },

  /**
   * Joins a collection and document ID into a compound key
   * @param {string} collection - The collection name
   * @param {string} docId - The document ID
   * @returns {string} The compound key
   * @throws {Error} If either component is invalid
   */
  join: function(collection, docId) {
    this.asCollectionName(collection);
    this.asDocId(docId);
    return collection + '/' + docId;
  }
};

module.exports = Formatted;