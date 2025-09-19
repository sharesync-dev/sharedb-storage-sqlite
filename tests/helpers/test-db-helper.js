/**
 * Test helper for managing temporary SQLite databases
 */
const fs = require('fs');
const path = require('path');
const BetterSqliteAdapter = require('@shaxpir/sharedb-storage-node-sqlite');

class TestDbHelper {
  constructor(testName) {
    this.testName = testName || 'test';
    this.dbDir = path.join(__dirname, '..', 'temp-dbs');
    this.dbPath = path.join(this.dbDir, `${this.testName}-${Date.now()}.db`);
    this.adapter = null;
  }

  async createAdapter(options) {
    // Ensure directory exists
    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { recursive: true });
    }

    // Create adapter
    this.adapter = new BetterSqliteAdapter(this.dbPath, {
      debug: false,
      ...options
    });

    await this.adapter.connect();
    return this.adapter;
  }

  async cleanup() {
    if (this.adapter) {
      await this.adapter.disconnect();
      this.adapter = null;
    }

    // Remove database file
    if (fs.existsSync(this.dbPath)) {
      try {
        fs.unlinkSync(this.dbPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    // Remove WAL files if they exist
    const walPath = this.dbPath + '-wal';
    const shmPath = this.dbPath + '-shm';
    if (fs.existsSync(walPath)) {
      try {
        fs.unlinkSync(walPath);
      } catch (e) {
        // Ignore
      }
    }
    if (fs.existsSync(shmPath)) {
      try {
        fs.unlinkSync(shmPath);
      } catch (e) {
        // Ignore
      }
    }
  }

  static cleanupAll() {
    const tempDir = path.join(__dirname, '..', 'temp-dbs');
    if (fs.existsSync(tempDir)) {
      try {
        const files = fs.readdirSync(tempDir);
        files.forEach(file => {
          const filePath = path.join(tempDir, file);
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            // Ignore
          }
        });
        fs.rmdirSync(tempDir);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}

module.exports = TestDbHelper;