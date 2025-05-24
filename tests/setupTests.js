import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Derive __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from the project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// You can add other global test setup here if needed
// For example, increase default timeout for all async tests if API calls are slow
// jest.setTimeout(60000); // Example: 60 seconds timeout for all tests 