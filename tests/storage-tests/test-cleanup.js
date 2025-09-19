const fs = require('fs');
const path = require('path');

/**
 * Helper to clean up test database files
 */
function cleanupTestDatabases(testDbDir) {
  if (!testDbDir) {
    testDbDir = path.join(__dirname, 'test-databases');
  }

  if (fs.existsSync(testDbDir)) {
    // Remove all .db files in the directory
    const files = fs.readdirSync(testDbDir);
    for (const file of files) {
      if (file.endsWith('.db') || file.endsWith('.db-wal') || file.endsWith('.db-shm')) {
        const filePath = path.join(testDbDir, file);
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          // Ignore errors - file might already be deleted
        }
      }
    }

    // Try to remove the directory if it's empty
    try {
      fs.rmdirSync(testDbDir);
    } catch (e) {
      // Directory might not be empty or already deleted
    }
  }
}

module.exports = { cleanupTestDatabases };