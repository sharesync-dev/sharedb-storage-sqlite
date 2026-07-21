/**
 * Regression tests for SqliteStorage.readRecordsBulk compound-key handling.
 *
 * DurableStore.getDocsBulk calls storage.readRecordsBulk('docs', [compoundKeys]),
 * where each id is "collection/docId". readRecordsBulk must split those into the
 * real collection + bare docIds before handing them to the schema strategy — the
 * strategy validates bare doc IDs (Formatted.asDocId rejects slashes) and queries
 * a per-collection table. Previously it forwarded storeName ('docs') as the
 * collection and the compound keys as ids, so bulk acquire threw "Document ID
 * cannot contain slashes" and callers fell back to slow individual reads.
 */

const expect = require('chai').expect;
const SqliteStorage = require('../lib/sqlite-storage');

// Build a SqliteStorage whose schema strategy just records the (type, collection,
// ids) it was asked for and returns one record per requested id.
function makeStorage() {
  const calls = [];
  const storage = Object.create(SqliteStorage.prototype);
  storage.ready = true;
  storage.adapter = {};
  storage.schemaStrategy = {
    readRecordsBulk: function (db, type, collection, ids, callback) {
      calls.push({ type, collection, ids: ids.slice() });
      const records = ids.map((docId) => ({
        id: collection + '/' + docId,
        payload: { collection, id: docId, data: { docId } },
      }));
      callback(null, records);
    },
  };
  return { storage, calls };
}

describe('SqliteStorage.readRecordsBulk compound-key handling', function () {
  it('splits "docs" compound keys into per-collection bare-id strategy calls', function (done) {
    const { storage, calls } = makeStorage();
    const ids = ['term/term1', 'session/session1', 'term/term2'];

    storage.readRecordsBulk('docs', ids, function (err, records) {
      expect(err).to.not.exist;

      // Grouped by collection, each queried with BARE doc ids (no slashes).
      expect(calls).to.have.lengthOf(2);
      const term = calls.find((c) => c.collection === 'term');
      const session = calls.find((c) => c.collection === 'session');
      expect(term, 'term group').to.exist;
      expect(session, 'session group').to.exist;
      expect(term.ids).to.deep.equal(['term1', 'term2']);
      expect(session.ids).to.deep.equal(['session1']);
      calls.forEach((c) => c.ids.forEach((id) => expect(id).to.not.contain('/')));

      // Records come back with compound .id and .payload intact (DurableStore
      // unwraps payload itself).
      const byId = {};
      records.forEach((r) => (byId[r.id] = r));
      expect(records).to.have.lengthOf(3);
      expect(byId['term/term1']).to.exist;
      expect(byId['session/session1'].payload.collection).to.equal('session');
      done();
    });
  });

  it('accepts a collection-name storeName with compound ids', function (done) {
    const { storage, calls } = makeStorage();

    storage.readRecordsBulk('term', ['term/term1', 'term/term2'], function (err, records) {
      expect(err).to.not.exist;
      expect(calls).to.have.lengthOf(1);
      expect(calls[0].collection).to.equal('term');
      expect(calls[0].ids).to.deep.equal(['term1', 'term2']);
      expect(records).to.have.lengthOf(2);
      done();
    });
  });

  it('treats a collection-name storeName with bare ids as that collection', function (done) {
    const { storage, calls } = makeStorage();

    storage.readRecordsBulk('term', ['term1', 'term2'], function (err) {
      expect(err).to.not.exist;
      expect(calls[0].collection).to.equal('term');
      expect(calls[0].ids).to.deep.equal(['term1', 'term2']);
      done();
    });
  });

  it('passes "meta" ids through bare with a null collection', function (done) {
    const { storage, calls } = makeStorage();

    storage.readRecordsBulk('meta', ['inventory'], function (err) {
      expect(err).to.not.exist;
      expect(calls[0].type).to.equal('meta');
      expect(calls[0].collection).to.equal(null);
      expect(calls[0].ids).to.deep.equal(['inventory']);
      done();
    });
  });

  it('returns [] for an empty id list without touching the strategy', function (done) {
    const { storage, calls } = makeStorage();

    storage.readRecordsBulk('docs', [], function (err, records) {
      expect(err).to.not.exist;
      expect(records).to.deep.equal([]);
      expect(calls).to.have.lengthOf(0);
      done();
    });
  });

  it('errors on a "docs" call with a bare (non-compound) id', function (done) {
    const { storage } = makeStorage();

    storage.readRecordsBulk('docs', ['term1'], function (err) {
      expect(err).to.exist;
      done();
    });
  });

  it('falls back to individual strategy reads when bulk is unsupported', function (done) {
    const calls = [];
    const storage = Object.create(SqliteStorage.prototype);
    storage.ready = true;
    storage.adapter = {};
    storage.schemaStrategy = {
      // No readRecordsBulk — force the per-id fallback.
      readRecord: function (db, type, collection, docId) {
        calls.push({ type, collection, docId });
        return Promise.resolve({ id: collection + '/' + docId, payload: { id: docId } });
      },
    };

    storage.readRecordsBulk('docs', ['term/term1', 'session/session1'], function (err, records) {
      expect(err).to.not.exist;
      expect(calls).to.deep.equal([
        { type: 'docs', collection: 'term', docId: 'term1' },
        { type: 'docs', collection: 'session', docId: 'session1' },
      ]);
      expect(records).to.have.lengthOf(2);
      done();
    });
  });
});
