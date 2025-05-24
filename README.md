# Pause Framework

The Pause Framework is a library designed to recover from runtime errors with the help of LLMs.

## Core Idea

The framework allows wrapping code execution with natural language instructions. If an error occurs during execution, the framework can:
1.  Catch the error.
2.  Pause the execution.
3.  Retrieve stack data and variable context.
4.  Allow an AI/LLM to provide modified code or a patch.
5.  Continue execution with the new code.
6.  Store successful modifications for future runs.

This enables a more interactive and resilient development process, particularly when integrating AI-generated code or tackling complex debugging scenarios.

## Installation

```bash
npm install pause-framework
# or
yarn add pause-framework
# or
pnpm add pause-framework
```

## Basic Usage

The core of the framework is the `pause.run()` method.

```javascript
// Import the framework
import Pause from 'pause-framework'; // Assuming using ES Modules

// Create a new instance
const pause = new Pause({
  // Add your DB functions here (required for persistence)
  getFunctionFromDb: async (id) => { /* ... */ return null; },
  saveFunctionToDb: async (id, codeString) => { /* ... */ }
});

// Use the framework to execute code
async function example() {
  const result = await pause.run(
    'unique-block-id-1',                // <-- Mandatory unique ID
    "Calculate the sum of two numbers", // <-- Description for AI context
    () => {
      let a = 1;
      let b = 2;
      return a + b;
    } // No external scope or args needed for this self-contained function
  );
  console.log('Result:', result);
}
```

**Key Parameters:**

*   `id` (String): A unique identifier for this specific code block. Used as the key for database persistence.
*   `description` (String): Natural language description for AI context.
*   `fnOrCode` (Function or String): The JavaScript function to execute or a string of code to be evaluated. If it's a function, it **must be syntactically valid**. Runtime errors within this function (e.g., reference errors) will be handled by the framework. This function is only executed if no corrected version associated with the `id` is found in the database.
*   `scope` (Object, optional): An object providing scope/context, primarily for when `fnOrCode` is a string. Defaults to `{}`.
*   `...args` (any): Arguments passed to `fnOrCode` when it is executed.

## How It Works

1.  Wrap code blocks in `pause.run()`, providing a unique `id`, `description`, and the initial, syntactically valid `fn`.
2.  The framework checks the database for a *code string* associated with the `id`.
3.  If DB code (a string) exists, it's executed (via `new Function()`). The provided `fn` is ignored.
4.  If no DB code exists, the provided `fn` is executed directly.
5.  If a *runtime error* occurs during the execution of the original local `fn`*, the framework:
    *   Captures context (error, `id`, description, original function code as string).
    *   Calls the configured LLM with a tool (`propose_corrected_block`) to get a corrected *code string*.
    *   Saves the corrected *code string* to the database using the `id`.
    *   Executes the newly corrected *code string* (via `new Function()`).
6.  If a *runtime error* occurs during the execution of code retrieved from the database, the framework will also attempt AI correction using the configured LLM, similar to how it handles errors in local code. If no LLM is configured, or if AI correction fails after retries, the error will be thrown.

## Configuration Options

### Custom Database Integration (Required for Persistence)

You **must** provide functions to interact with your storage.

```javascript
import Pause from 'pause-framework';

const pause = new Pause({
  getFunctionFromDb: async (id) => { /* Return stored function string or null */ },
  saveFunctionToDb: async (id, functionString) => { /* Save function string */ }
});
```

### LLM Configuration (Optional)

Defaults to OpenAI (`gpt-4o-mini`) if `OPENAI_API_KEY` is set in your environment.

```javascript
import Pause from 'pause-framework';
import { ChatOpenAI } from '@langchain/openai';

const pause = new Pause({
  llm: new ChatOpenAI({ modelName: 'gpt-4', temperature: 0.1 }), // Example customization
  getFunctionFromDb: async (id) => { /* ... */ },
  saveFunctionToDb: async (id, functionString) => { /* ... */ }
});
```

## Handling Nested Calls

Ensure each nested `pause.run` has its own unique `id`.

```javascript
import Pause from 'pause-framework';
// ... setup pause instance with DB handlers ...

await pause.run(
  'outer-op-id',
  "Outer operation",
  async () => {
    const a = 1, b = 2;
    return await pause.run(
      'inner-calc-id', // Different unique ID
      "Inner calculation with runtime error",
      () => { // Must be a function
        return a + someUndefinedVar + b; // Example runtime error
      }
    );
  }
);
```

## Examples

See the `examples/` directory in the repository for runnable code examples that demonstrate various use cases and features of the framework.

## Environment Variables

For the default LLM configuration (OpenAI), the `OPENAI_API_KEY` environment variable must be set. This library **does not** load `.env` files (e.g., using `dotenv`) on its own. You are responsible for ensuring that environment variables are loaded into your Node.js process if you rely on them (e.g., via your shell, a Docker environment, or a startup script like `node --env-file=.env your-app.js` for Node.js v20.6.0+).

## Security Considerations

This framework uses `new Function()` and potentially `eval()` (if string-based code blocks are used without a direct function) to execute code dynamically. This is a core part of its functionality, allowing it to run corrected code or code retrieved from a database.

**Important:** Executing arbitrary code strings, especially if they can be influenced by external sources (like an LLM or a database that could be compromised), carries inherent security risks. 
- Always ensure that the source of the code strings (both from the LLM and your database) is trusted.
- Be cautious about the permissions of the environment where this code runs.
- Sanitize or validate any inputs that might be used to construct or influence these dynamic code blocks if they originate from untrusted user input (though the primary design is for developer-provided or AI-corrected code).

The AI correction mechanism itself also means that the behavior of your code can change based on LLM responses. While the goal is to fix errors, ensure you have monitoring and review processes in place for AI-generated code, especially in critical systems.

## Limitations and Future Considerations

*   **LLM Response Parsing:** The framework expects a specific tool call format from the LLM. While it attempts to handle common structures, highly varied or unexpected LLM responses might not be parsed correctly, preventing AI correction. Future versions may include more robust parsing or allow for custom response handlers.
*   **Complex Debugging Scenarios:** While the framework can retrieve basic error information and context, very complex debugging scenarios requiring deep stack introspection or analysis of memory states are beyond the current scope.
*   **Deterministic Corrections:** AI-generated corrections can be non-deterministic. The same error might result in slightly different corrected code on subsequent attempts, though the goal is always functional equivalence and a fix for the error.
*   **Cost of LLM Calls:** Each AI correction attempt involves an LLM call, which may have associated costs depending on the provider and model used.

## License

MIT License, Free, etc. I can't stop you from using this ideea for your own projects.
This project is actually my last neuron's breath, I'm burning out fast and won't be able to work a 9-5 for long. It would help me a lot if you could support me or buy me a coffee, and it might just make me work on this project more and finally get some meaning in life.
