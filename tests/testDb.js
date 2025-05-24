import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'tests', 'pause_test_db.json');

/**
 * Reads the JSON database file.
 * @returns {object} The database object or an empty object if file doesn't exist or is invalid.
 */
function readDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading pause_test_db.json:', error);
  }
  return {};
}

/**
 * Writes the database object to the JSON file.
 * @param {object} db The database object to write.
 */
function writeDb(db) {
  try {
    // Ensure the tests directory exists
    const testsDir = path.dirname(DB_FILE);
    if (!fs.existsSync(testsDir)) {
      fs.mkdirSync(testsDir, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing to pause_test_db.json:', error);
  }
}

/**
 * Retrieves a stored function string from the DB by its ID.
 * @param {string} id The unique ID of the code block.
 * @returns {Promise<string|null>} The function code string or null if not found.
 */
async function getFunctionFromDb(id) {
  const db = readDb();
  return db[id] || null;
}

/**
 * Saves a function string to the DB, keyed by its ID.
 * @param {string} id The unique ID of the code block.
 * @param {string} functionString The function code string to save.
 */
async function saveFunctionToDb(id, functionString) {
  const db = readDb();
  db[id] = functionString;
  writeDb(db);
}

/**
 * Clears the test database
 */
function clearTestDb() {
  if (fs.existsSync(DB_FILE)) {
    fs.unlinkSync(DB_FILE);
  }
}

export { 
  getFunctionFromDb, 
  saveFunctionToDb, 
  clearTestDb,
  DB_FILE 
}; 