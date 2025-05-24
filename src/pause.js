// Load environment variables
// require('dotenv').config(); // Removed for ESM

import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from 'langchain/tools';
import { HumanMessage } from "@langchain/core/messages"; // Import HumanMessage

// Helper to determine if a function string likely represents an async function
const isLikelyAsyncString = (code) => /^(async\s+)?function\*?|async\s+=>|async\s+\(/.test(code.trim());

// Helper to get AsyncFunction constructor. Placed at the top for clarity.
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

class Pause {
  /**
   * Creates an instance of the Pause framework.
   * @param {Object} [options={}] - Configuration options for the Pause framework.
   * @param {Function} options.getFunctionFromDb - Async function to retrieve stored function string by id. Must return a Promise resolving to the string or null.
   * @param {Function} options.saveFunctionToDb - Async function to store corrected function string by id. Must return a Promise.
   * @param {import('@langchain/openai').ChatOpenAI} [options.llm] - Optional LangChain LLM instance (e.g., ChatOpenAI). If not provided and OPENAI_API_KEY is set, a default ChatOpenAI instance is created.
   * @param {string} [options.modelName='gpt-4o-mini'] - OpenAI model name to use for the default LLM.
   * @param {number} [options.temperature=0] - Temperature setting for the default LLM.
   * @param {number} [options.maxTokens=1024] - Max tokens setting for the default LLM.
   * @param {number} [options.maxAiRetries=3] - Maximum number of AI correction retries.
   * @param {...any} args - Arguments to pass to the function.
   * @returns {Promise<any>} - The result of the function execution.
   * @throws {Error} If fnOrCode is invalid type, execution fails (including DB code execution errors), or AI correction fails after retries.
   */
  constructor(options = {}) {
    this.getFunctionFromDb = options.getFunctionFromDb || (async () => null);
    this.saveFunctionToDb = options.saveFunctionToDb || (async () => {});
    this.maxAiRetries = typeof options.maxAiRetries === 'number' ? options.maxAiRetries : 3;

    this.llm = options.llm;
    if (!this.llm && process.env.OPENAI_API_KEY) {
      try {
        this.llm = new ChatOpenAI({
          modelName: options.modelName || 'gpt-4o-mini', 
          temperature: options.temperature || 0,
          maxTokens: options.maxTokens || 1024
        });
        console.log(`[Pause] LLM Initialized via OPENAI_API_KEY (Model: ${this.llm.modelName})`);
      } catch (llmError) {
        console.error("[Pause] Failed to initialize LLM from API key:", llmError);
        this.llm = null;
      }
    } else if (this.llm) {
      console.log('[Pause] LLM provided in options');
    } else {
      console.log('[Pause] LLM not configured.');
    }
  }

  /**
   * Executes a given function or code string associated with an ID.
   * If code exists in the database for the ID, it's executed instead of `fnOrCode`.
   * Handles errors and attempts AI correction if the error source is the local `fnOrCode`.
   * @param {string} id - The unique identifier for this code block.
   * @param {string} description - A natural language description of what the code should do.
   * @param {Function|string} fnOrCode - The function or code string to execute (used if no DB code).
   * @param {Object} [scope={}] - Optional scope object for eval-based execution (use with caution).
   * @param {...any} args - Arguments to pass to the function.
   * @returns {Promise<any>} - The result of the function execution.
   * @throws {Error} If fnOrCode is invalid type, execution fails (including DB code execution errors), or AI correction fails after retries.
   */
  async run(id, description, fnOrCode, scope = {}, ...args) {
    let executionSource = 'local';
    let originalCodeString = typeof fnOrCode === 'function' ? fnOrCode.toString() : fnOrCode;

    if (typeof fnOrCode !== 'function' && typeof fnOrCode !== 'string') {
      throw new Error('[Pause] Invalid type for fnOrCode: must be a function or string.');
    }

    try {
      const savedFunctionString = await this.getFunctionFromDb(id);
      if (savedFunctionString) {
        console.log(`[Pause] Using DB version for block ID: ${id}`);
        executionSource = 'db';
        return await this._executeFunctionString(savedFunctionString, id, ...args);
      } else {
        console.log(`[Pause] Using local version for block ID: ${id}`);
        executionSource = 'local';
        if (typeof fnOrCode === 'function') {
          return await fnOrCode(...args);
        } else { 
          return await this._executeCodeStringViaEval(fnOrCode, id, scope, ...args);
        }
      }
    } catch (error) {
      console.error(`[Pause] Error during execution of block ID: ${id} (Source: ${executionSource})`, error);

      if (this.llm) {
        console.log(`[Pause] Error caught for ID ${id}. Initiating AI correction attempts (max: ${this.maxAiRetries}).`);
        
        let lastAiAttemptError = null;
        for (let attempt = 1; attempt <= this.maxAiRetries; attempt++) {
          try {
            const correctedCode = await this._attemptAICorrection(id, description, originalCodeString, error, args, attempt);
            
            await this.saveFunctionToDb(id, correctedCode);
            console.log(`[Pause] Saved AI-corrected code for block ID: ${id} (Attempt ${attempt}).`);
            console.log(`[Pause] Executing AI-corrected code for block ID: ${id}...`);
            return await this._executeFunctionString(correctedCode, id, ...args);
          } catch (aiAttemptError) {
            lastAiAttemptError = aiAttemptError; 
            console.error(`[Pause] AI Correction attempt #${attempt} failed for block ID: ${id}:`, aiAttemptError);
            if (attempt === this.maxAiRetries) {
              console.error(`[Pause] All ${this.maxAiRetries} AI correction attempts failed for block ID: ${id}.`);
              throw new Error(`Max AI retries reached for block ID: ${id}. Last AI error: ${lastAiAttemptError ? lastAiAttemptError.message : 'N/A'}. Original error: ${error.message}`);
            }
          }
        }
      } else {
        console.log(`[Pause] No LLM configured. Cannot attempt AI correction for ID ${id}.`);
        throw error;
      }
    }
  }

  // --- Private Helper Methods ---

  /**
   * Attempts to get a corrected code string from the configured LLM.
   * @private
   * @param {string} id - The unique identifier for the code block.
   * @param {string} description - A natural language description of what the code should do.
   * @param {string} originalCodeString - The original code string that caused the error.
   * @param {Error} originalError - The error object caught during execution.
   * @param {any[]} args - The arguments passed to the function when the error occurred.
   * @param {number} attemptNumber - The current attempt number for this correction.
   * @returns {Promise<string>} - The corrected code string.
   * @throws {Error} If AI correction fails (e.g., bad response, invalid code).
   */
  async _attemptAICorrection(id, description, originalCodeString, originalError, args, attemptNumber) {
    console.log(`[Pause] AI Correction internal attempt #${attemptNumber} for block ID: ${id}...`);

    const correctionToolInstance = this._createCorrectionTool(id);
    const llmWithTool = this.llm.bindTools([correctionToolInstance]);
    const promptText = this._buildCorrectionPrompt(id, description, originalCodeString, originalError, args);
    
    console.log('[Pause] Invoking LLM for correction...');
    const aiResponse = await llmWithTool.invoke([new HumanMessage({ content: promptText })]);
    console.log('[Pause] Raw LLM aiResponse:', JSON.stringify(aiResponse, null, 2));

    if (!aiResponse.tool_calls || aiResponse.tool_calls.length === 0) {
      throw new Error(`AI failed to propose a correction using the tool. Response content: ${aiResponse.content}`);
    }

    const toolCall = aiResponse.tool_calls[0];
    console.log('[Pause] Found tool call in aiResponse.tool_calls:', JSON.stringify(toolCall, null, 2));

    let parsedArgs = toolCall.args;
    if (typeof parsedArgs === 'string') {
      try {
        parsedArgs = JSON.parse(parsedArgs);
      } catch (parseError) {
        throw new Error(`Failed to parse tool call arguments string: ${parseError.message}`);
      }
    }

    if (toolCall.name !== 'propose_corrected_block' || typeof parsedArgs !== 'object' || parsedArgs === null) {
      throw new Error(`AI responded with unexpected tool call structure or args: ${JSON.stringify(toolCall)}`);
    }

    const correctedCode = parsedArgs.corrected_code;
    const receivedBlockId = parsedArgs.block_id;

    if (receivedBlockId !== id) {
      throw new Error(`AI tool call had mismatched block_id. Expected ${id}, got ${receivedBlockId}`);
    }
    if (!correctedCode || typeof correctedCode !== 'string') {
      throw new Error(`AI tool call did not return a valid corrected_code string.`);
    }

    try {
      new Function(`return ${correctedCode}`)();
    } catch (e) {
      throw new Error(`AI proposed invalid JavaScript syntax: ${e.message}\nCode: ${correctedCode}`);
    }
    return correctedCode;
  }

  /**
   * Builds the prompt for the LLM correction task.
   * @private
   * @param {string} id - The unique identifier for the code block.
   * @param {string} description - A natural language description of what the code should do.
   * @param {string} originalCode - The original code string that caused the error.
   * @param {Error} error - The error object caught during execution.
   * @param {any[]} args - The arguments passed to the function when the error occurred.
   * @returns {string} - The prompt string for the LLM.
   */
  _buildCorrectionPrompt(id, description, originalCode, error, args) {
    const contextInfo = {
      id, 
      description, 
      error: error.toString(), 
      stack: error.stack, 
      originalCode,
      args: JSON.stringify(args)
    };
    
    return `
You are an expert JavaScript debugging assistant. You are tasked with correcting a JavaScript function block identified by a specific ID. Review the provided information and use the 'propose_corrected_block' tool to submit your correction.

BLOCK ID: ${id}
DESCRIPTION OF WHAT THE BLOCK SHOULD DO:
${description}

ORIGINAL FUNCTION CODE (from the source file):
\`\`\`javascript
${contextInfo.originalCode}
\`\`\`

ERROR THAT OCCURRED (when running the original code):
${contextInfo.error}

STACK TRACE:
${contextInfo.stack}

FUNCTION ARGUMENTS (passed when the error occurred):
${contextInfo.args}

Your task is to provide a corrected version of the function code.

CORRECTION REQUIREMENTS:
1. The corrected code must fix the specific error reported.
2. It must fulfill the original description of what the block should do.
3. It must be a complete, syntactically valid JavaScript function string (e.g., '() => new Date()', or 'async (x) => { return x * x; }').
4. The function string should be self-contained or correctly use variables from its closure if applicable (be mindful of the scope when new Function() is used for execution).
5. If the original function took arguments, the corrected function string must also accept them.

TOOL USAGE:
- You MUST use the 'propose_corrected_block' tool.
- The arguments for the tool MUST be a JSON object with two keys:
  1. 'block_id': This MUST be the string "${id}".
  2. 'corrected_code': This MUST be the corrected JavaScript function string.

Example of how to call the tool (this is what you should output if you decide to use the tool):
If the block ID is "test-123" and the corrected code is "() => { return 42; }", you would call the tool 'propose_corrected_block' with arguments: { "block_id": "test-123", "corrected_code": "() => { return 42; }" }

Do not add any other text or explanation outside of the tool call. Only call the tool.`;
  }

  /**
   * Creates a tool for the LLM to propose a correction for a specific code block.
   * @private
   * @param {string} id - The unique identifier for the code block, used to ensure the LLM targets the correct block.
   * @returns {import('langchain/tools').DynamicStructuredTool} - The LangChain tool for proposing corrections.
   */
  _createCorrectionTool(id) {
    return new DynamicStructuredTool({
      name: 'propose_corrected_block',
      description: `Propose a corrected, syntactically valid JavaScript function string to fix an error in block ID ${id}.`,
      schema: {
        type: 'object',
        properties: {
          block_id: { type: 'string', description: `The unique ID of the code block (must be ${id}).` },
          corrected_code: { 
            type: 'string', 
            description: 'The corrected, complete, and syntactically valid JavaScript function string (e.g., "() => new Date()").' 
          }
        },
        required: ['block_id', 'corrected_code']
      },
      // Tool function simply validates the input structure and basic syntax
      func: async ({ block_id, corrected_code }) => {
        if (block_id !== id) {
          return `Tool Error: Incorrect block_id. Expected ${id}, got ${block_id}`;
        }
        try {
          new Function(`return ${corrected_code}`)();
          return `Successfully validated proposed corrected code for block ${block_id}.`;
        } catch (e) {
          return `Tool Error: Proposed code is not valid JavaScript syntax: ${e.message}`;
        }
      }
    });
  }
  
  /**
   * Creates and executes a function from a string using new Function(), handling async.
   * @private
   * @param {string} codeString - The string representation of the function.
   * @param {string} id - The unique identifier for the code block (for logging).
   * @param {...any} args - Arguments to pass to the function.
   * @returns {Promise<any>} - The result of the function execution.
   * @throws {Error} If function creation or execution fails.
   */
  async _executeFunctionString(codeString, id, ...args) {
    try {
      let fn;
      // Construct the body to directly execute the code string and return its result
      // Pass original arguments directly, not wrapped in an array
      const funcBody = `return (${codeString})(...arguments);`; 
      if (isLikelyAsyncString(codeString)) {
        // Create an async function that accepts the original arguments directly
        fn = new AsyncFunction(...Array(args.length).fill(0).map((_, i) => `arg${i}`), funcBody.replace('...arguments', args.map((_, i) => `arg${i}`).join(', ')));
      } else {
        // Create a sync function that accepts the original arguments directly
        fn = new Function(...Array(args.length).fill(0).map((_, i) => `arg${i}`), funcBody.replace('...arguments', args.map((_, i) => `arg${i}`).join(', ')));
      }
      // Call the dynamic function with the spread original arguments
      return await fn(...args);
    } catch (error) {
      console.error(`[Pause] Error executing function string for ID ${id}:`, error);
      // Add context to the error message
      error.message = `Error executing function string for ID ${id}: ${error.message}`;
      throw error; 
    }
  }

  /**
   * Executes a code string using eval(), attempting to provide scope.
   * CAUTION: Uses eval. Ensure code strings are trusted or sandboxed if necessary.
   * @private
   * @param {string} codeString - The string representation of the code to execute.
   * @param {string} id - The unique identifier for the code block (for logging).
   * @param {Object} [scope={}] - An object representing the scope to be available during eval.
   * @param {...any} args - Arguments intended to be used by the code string, typically mapped to variables within the `scope`.
   * @returns {Promise<any>} - The result of the evaluated code.
   * @throws {Error} If eval fails.
   */
  async _executeCodeStringViaEval(codeString, id, scope = {}, ...args) {
    const evalWrapper = async () => {
      // Corrected regex for parameter matching
      const paramMatch = codeString.match(/\((.*?)\)/);
      const params = paramMatch ? paramMatch[1].split(',').map(p => p.trim()).filter(Boolean) : [];
      
      const executionScope = { ...scope };
      params.forEach((param, index) => {
        executionScope[param] = args[index];
      });

      let body = codeString;
      // Corrected regex for body matching (simplified)
      const bodyMatch = codeString.match(/=>\s*{(.*)}\s*$|function.*?{(.*)}\s*$/s);
      if (bodyMatch) {
         body = bodyMatch[1] || bodyMatch[2] || body; 
      }
      // Corrected regex for arrow body matching
      const arrowBodyMatch = codeString.match(/=>\s*(.*)/s);
      if (!bodyMatch && arrowBodyMatch) {
          body = `return ${arrowBodyMatch[1]}`;
      }

      const keys = Object.keys(executionScope);
      const values = Object.values(executionScope);
      
      // Construct an async function dynamically to handle await within the eval'd code
      const evalFn = new AsyncFunction(...keys, ` ${body} `);
      
      return await evalFn(...values);
    };

    try {
      return await evalWrapper();
    } catch (error) {
      console.error(`[Pause] Error executing code string via eval for ID ${id}:`, error);
      error.message = `Error executing code string via eval for ID ${id}: ${error.message}`;
      throw error;
    }
  }
}

// Helper to get AsyncFunction constructor - MOVED TO TOP OF FILE AND CONSOLIDATED
// const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

export default Pause;