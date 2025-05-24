/**
 * Basic usage example for the Pause Framework.
 * 
 * Run this file with Node.js:
 * If your Node version supports it (v20.6.0+), you can load .env automatically:
 * $ node --env-file=.env examples/basic-usage.js
 * Otherwise, ensure OPENAI_API_KEY is set in your environment.
 */
import Pause from '../src/index.js'; // Use .js for ESM

// Create a new instance of the Pause framework
// For persistence, you MUST provide getFunctionFromDb and saveFunctionToDb
const inMemoryDb = {};
const pause = new Pause({
    getFunctionFromDb: async (id) => inMemoryDb[id] || null,
    saveFunctionToDb: async (id, codeString) => {
        console.log(`[DB] Saving code for ID: ${id}`);
        inMemoryDb[id] = codeString;
    }
});

async function run() {
  console.log('Example 1: Correctly working function');
  const result1 = await pause.run(
    'date-correct-1', 
    "Get current date",
    () => { 
      const today = new Date();
      return today;
    }
  );
  console.log(`Result 1: ${result1}`);

  console.log('\nExample 2: Function with a runtime error');
  try {
    const result2 = await pause.run(
      'date-error-1', 
      "Get current date",
      () => { 
        const today = new date(); // Intentional error: lowercase 'date'
        return today;
      }
    );
    console.log(`Result 2 (Corrected): ${result2}`);
  } catch (error) {
    console.error('Error in Example 2 was not corrected by AI (should have been): ', error);
  }

  console.log('\nExample 3: Nested calls with runtime error');
  try {
    const result3 = await pause.run(
      'nested-outer-1', 
      "Perform a math operation that involves adding two numbers.",
      async () => {
        const a = 5;
        const b = 10;
        return await pause.run(
          'nested-inner-1', 
          "Add the numbers a and b.",
          () => { 
            return a + someUndefinedVar + b; // eslint-disable-line no-undef
          },
          { a, b }
        );
      }
    );
    console.log(`Result 3 (Corrected Nested): ${result3}`);
  } catch (error) {
    console.error('Error in Example 3 was not corrected by AI (should have been): ', error);
  }

  console.log('\nExample 4: AI Correction for logical error & DB Override');
  const taskId = 'square-calc-1';
  const taskDesc = "Calculate square of a number (x * x)";
  
  const originalFaultyFn = (x) => { 
    console.log(`Executing originalFaultyFn for ${taskId} with x=${x}`);
    return x * x * x; 
  };
  
  try {
    console.log('\nRunning task for the first time (expecting AI correction for logic):');
    const result4 = await pause.run(
      taskId,
      taskDesc,
      originalFaultyFn,
      3 
    );
    console.log(`Result 4 (First run, AI corrected for logic): ${result4}`); 

    console.log('\nRunning task for the second time (expecting DB version):');
    const result5 = await pause.run(
      taskId, 
      taskDesc, 
      originalFaultyFn, 
      4 
    );
    console.log(`Result 5 (Second run, from DB): ${result5}`); 
    
    console.log(`\nDB content for ID ${taskId}:`, inMemoryDb[taskId]);

    console.log('\nExample 5: Error in DB code (AI correction will be attempted if LLM is configured)');
    const dbErrorId = 'db-error-id-1';
    // This function string, when loaded from DB, will cause an error.
    inMemoryDb[dbErrorId] = '() => { return nonExistentDbVar + 1; }'; 
    const dbErrorDesc = "This DB code has an error (nonExistentDbVar). Please fix it to return the number 42.";

    try {
        const resultDbError = await pause.run(
            dbErrorId,
            dbErrorDesc, // A more specific description to guide AI
            () => "This local function is fine and should ideally not be called if DB code exists."
        );
        console.log(`[Example 5] Result after attempting to run/correct DB code for ${dbErrorId}: ${resultDbError}`);
        if (pause.llm && resultDbError === 42) {
            console.log(`[Example 5] AI correction appears to have successfully fixed the DB code to return 42.`);
        } else if (pause.llm) {
            console.log(`[Example 5] AI correction was attempted, but the result wasn't the specifically expected 42 (or the original error was benign).`);
        }
    } catch (e) {
        console.log(`[Example 5] Caught error after attempting to run/correct DB code for ${dbErrorId}: ${e.message}`);
        if (pause.llm) {
            console.log("[Example 5] This means AI correction was attempted (as an LLM is configured) but ultimately failed after retries.");
        } else {
            console.log("[Example 5] AI correction was NOT attempted as no LLM is configured (e.g., OPENAI_API_KEY not set). This is the original error from the DB code execution attempt.");
        }
    }

  } catch (error) {
    console.error('Error in Example 4 or 5:', error);
  }
}

run().catch(console.error); 