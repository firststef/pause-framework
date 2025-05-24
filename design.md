# The P (Pause) Framework

Because AI is not yet able to write correct code from one shot, we need to create a framework that will allow us to write code, run it, when an error occurs, pause the execution, retrieve data on the stack, modify code, continue running it, and supervise it. We will call it Pause Framework.
We need to make it standalone because I want to post it on GitHub and use it in other projects.
How will it work:
1. Inside the codebase, instructions on what the code should do are written inside a call to the Pause Framework, next to the code that should be executed.
Ex:
```js
const result = await pause.run(
    "Retrive today's date",
    () => {
      const today = new Date();
      return today;
    }
);
```
If this code was incorrect, for example we had `new date()` instead of `new Date()`, the framework would catch the execution, generate a new function that will be executed instead, and then continue the execution. Of course, the framework also keeps the new version in a db, and when the db changes, the user can provide code to connect and update his real database. The framework retrieves the code from the db with a custom getter by the user also.

2. What about variables in blocks?
Let's say we have a block of code that computes two external variables.
```js
await pause.run(
    () => {
      let a = 1;
      let b = 2;
      return pause.run(
        "Divide a and b",
        () => {
          return a ++++ b;
        }
      );
    }
);
```
Obviously, there is an error in the code. The AI receives the context for the block of code, the values of the variables (retrieved from the stack), and the error. The AI will then generate a new function that will be executed with eval(). eval() will have access to the variables on the stack, so it should be fine.

3. Now, what if the variables need to change dramatically?
The AI will also be able to generate a "patch" code function, which will be executed with eval() also, with the entire purpose of patching the variables in the code. The AI can also decide if it needs to change the above function even dramatically, and the "patch" function might just copy the rest of the original function till the end, instead of letting the new eval() function continue, in order to make the patch more efficient.

4. How will we build this?
- With LangChain for the LLM calls.
- Tool calls in langchain. They work the best for this kind of task. Tools will be like "update_p_function", "run_patch_function", "retrieve_stack", "retrieve_up_context", etc.

---

ok, so I haven't actually thought this trough completely. because we need to have a place where the new code will be put from db, we also need to have an id
ex:
```js
await pause.run(
  "main-1",
  "Compute the sum of a and b",
  () => {
    let a = 1;
    let b = 2;
    return a + b;
  }
)
```
this way, when the llm calls update_p_function, or better we should call it update_p_block, it will know which block to update.
at the beginning of the pause framework execution, it retrieves from the db the main-1 block, and the other blocks of course. the 
code that is retrieved from the db will be the code that is executed, not the code that is written in the pause.run call.
we should have a test for this, in which the pause.run will be called with a code that has an error, and the test will check if the db code is called instead, it would fail if it's not.

at a latter date, the user will call pause.generate(...) with the source code, and the framework will generate the new files, with the new code being put in the pause.run call. but for now we don't need this asap.

---

it's true, this is problematic if the syntax is wrong. the original file will not even compile. let's add support for another type of the function/block/code parameter, which will be a string, and not a function. if it's a string, it will be evaluated with eval() instead of being executed.
