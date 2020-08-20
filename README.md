# AutoCLI

*This is alpha stage software, feedback welcome*

When building CLIs for testing and admin of my code I often found that I had to repeat a lot of code. More importantly, I found that I wrote roughly the same texts both in JS Docs as in the help output of CLI commands.

**AutoCLI** is a small library with single function call that will generate a complete CLI for your Node.js project. It just needs to know what source files it should parse for JSDoc, and it will use that to build a model for what commands (functions) can be called, their names, description and accepted parameters.

## How it works

Using the excellent `jsdoc-api` package we can scan Javascript source files for JS Doc comments. Let's say you have this function:

```js
// math.js
/**
 *	Adds two numbers.
 *
 * @param {number} a first number
 * @param {number} b second number
 * @returns {number}
 */
exports.adder = async function (a, b) {
    return a+b;
}
```

Let's say your entry point script is:
```js
// index.js
const { autoCLI } = require('node-autocli');

if (require.main === module) {
    await autoCLI(process.argv, 'math.js');
}
```
If you call `node index.js adder <a> <b>` it will run the function and output the result, or if you type something wrong, it will give you a help screen.

## Features

- Generates a nice-looking automated help and version commands that lists all commands, plus top-level CLI information like description and version pulled from your `package.json`
- Prints help and parameters, including type and defaults, for individual commands
- Can handle a flat list of commands or commands nested into command groups
- Tries to guess which command the user intended if it can't find what was typed
- Can be provided an object of internal arguments that will be populated in code and not exposed to CLI users, so that you don't need to maintain different versions of your function
- Can take arguments as JSON encoded text or path to a JSON file
- If provided JSON is an array, it will run the command for each element, so it becomes a simple batch runner for commands


## Planned features

- Automatically parse and convert the input based on parameter types
- Fall back on parsing function signatures if no JS Doc available
- JSON from stdin
- Return a list of promises
- Utilize environment variables
