/**
 * Tests for Formatted utility
 */

const expect = require('chai').expect;
const Formatted = require('../lib/utils/formatted');

describe('Formatted utility', function() {

  describe('asCompoundKey', function() {
    it('should accept valid compound keys', function() {
      expect(Formatted.asCompoundKey('users/user123')).to.equal('users/user123');
      expect(Formatted.asCompoundKey('manifest/m3ttEidoeclNAhlT')).to.equal('manifest/m3ttEidoeclNAhlT');
      expect(Formatted.asCompoundKey('a/b')).to.equal('a/b');
    });

    it('should reject empty strings', function() {
      expect(() => Formatted.asCompoundKey('')).to.throw('Compound key cannot be empty');
      expect(() => Formatted.asCompoundKey(null)).to.throw('Compound key cannot be empty');
      expect(() => Formatted.asCompoundKey(undefined)).to.throw('Compound key cannot be empty');
    });

    it('should reject strings without slashes', function() {
      expect(() => Formatted.asCompoundKey('nodocid')).to.throw('must contain a slash');
    });

    it('should reject strings starting with slash', function() {
      expect(() => Formatted.asCompoundKey('/users/user123')).to.throw('cannot start with a slash');
    });

    it('should reject strings ending with slash', function() {
      expect(() => Formatted.asCompoundKey('users/')).to.throw('cannot end with a slash');
    });

    it('should reject multiple slashes in document ID', function() {
      expect(() => Formatted.asCompoundKey('users/path/to/doc')).to.throw('Document ID part of compound key cannot contain slashes');
      expect(() => Formatted.asCompoundKey('collection/sub/category/item')).to.throw('Document ID part of compound key cannot contain slashes');
    });
  });

  describe('asCollectionName', function() {
    it('should accept valid collection names', function() {
      expect(Formatted.asCollectionName('users')).to.equal('users');
      expect(Formatted.asCollectionName('manifest')).to.equal('manifest');
      expect(Formatted.asCollectionName('user_profiles')).to.equal('user_profiles');
      expect(Formatted.asCollectionName('collection123')).to.equal('collection123');
    });

    it('should reject empty strings', function() {
      expect(() => Formatted.asCollectionName('')).to.throw('Collection name cannot be empty');
      expect(() => Formatted.asCollectionName(null)).to.throw('Collection name cannot be empty');
    });

    it('should reject names with slashes', function() {
      expect(() => Formatted.asCollectionName('bad/collection')).to.throw('Collection name cannot contain slashes');
      expect(() => Formatted.asCollectionName('users/posts')).to.throw('Collection name cannot contain slashes');
      expect(() => Formatted.asCollectionName('/users')).to.throw('Collection name cannot contain slashes');
      expect(() => Formatted.asCollectionName('users/')).to.throw('Collection name cannot contain slashes');
    });
  });

  describe('asDocId', function() {
    it('should accept valid document IDs', function() {
      expect(Formatted.asDocId('user123')).to.equal('user123');
      expect(Formatted.asDocId('m3ttEidoeclNAhlT')).to.equal('m3ttEidoeclNAhlT');
      expect(Formatted.asDocId('doc_with_underscores')).to.equal('doc_with_underscores');
      expect(Formatted.asDocId('123')).to.equal('123');
    });

    it('should reject empty strings', function() {
      expect(() => Formatted.asDocId('')).to.throw('Document ID cannot be empty');
      expect(() => Formatted.asDocId(null)).to.throw('Document ID cannot be empty');
    });

    it('should reject IDs with slashes', function() {
      expect(() => Formatted.asDocId('bad/id')).to.throw('Document ID cannot contain slashes');
      expect(() => Formatted.asDocId('category/subcategory')).to.throw('Document ID cannot contain slashes');
      expect(() => Formatted.asDocId('/doc')).to.throw('Document ID cannot contain slashes');
      expect(() => Formatted.asDocId('doc/')).to.throw('Document ID cannot contain slashes');
    });
  });

  describe('split', function() {
    it('should split valid compound keys', function() {
      const result = Formatted.split('users/user123');
      expect(result.collection).to.equal('users');
      expect(result.docId).to.equal('user123');
    });

    it('should handle single character parts', function() {
      const result = Formatted.split('a/b');
      expect(result.collection).to.equal('a');
      expect(result.docId).to.equal('b');
    });

    it('should reject invalid compound keys', function() {
      expect(() => Formatted.split('noSlash')).to.throw();
      expect(() => Formatted.split('/startSlash')).to.throw();
      expect(() => Formatted.split('endSlash/')).to.throw();
      expect(() => Formatted.split('has/multiple/slashes')).to.throw();
    });
  });

  describe('join', function() {
    it('should join valid collection and document IDs', function() {
      expect(Formatted.join('users', 'user123')).to.equal('users/user123');
      expect(Formatted.join('manifest', 'm3ttEidoeclNAhlT')).to.equal('manifest/m3ttEidoeclNAhlT');
    });

    it('should reject invalid collection names', function() {
      expect(() => Formatted.join('bad/collection', 'doc123')).to.throw('Collection name cannot contain slashes');
      expect(() => Formatted.join('', 'doc123')).to.throw('Collection name cannot be empty');
    });

    it('should reject invalid document IDs', function() {
      expect(() => Formatted.join('users', 'bad/id')).to.throw('Document ID cannot contain slashes');
      expect(() => Formatted.join('users', '')).to.throw('Document ID cannot be empty');
    });
  });

  describe('integration with inventory storage', function() {
    it('should validate formats used in inventory operations', function() {
      // These are the patterns used in CollectionPerTableStrategy

      // Valid operations
      expect(() => {
        const collection = Formatted.asCollectionName('users');
        const docId = Formatted.asDocId('user123');
        // Would store in inventory
      }).to.not.throw();

      // Invalid operations that should be caught
      expect(() => {
        Formatted.asDocId('users/user123'); // Compound key in inventory
      }).to.throw('Document ID cannot contain slashes');

      expect(() => {
        Formatted.asCollectionName('bad/name');
      }).to.throw('Collection name cannot contain slashes');
    });

    it('should properly extract document ID from compound key', function() {
      const compoundKey = 'manifest/m3ttEidoeclNAhlT';
      const parts = Formatted.split(compoundKey);

      // This is what gets stored in inventory
      expect(parts.docId).to.equal('m3ttEidoeclNAhlT');
      expect(parts.docId).to.not.include('/');

      // Validate it's a proper document ID
      expect(Formatted.asDocId(parts.docId)).to.equal('m3ttEidoeclNAhlT');
    });
  });
});