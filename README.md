# AutoCLI

*This is alpha stage software, feedback welcome*

When building CLIs for testing and admin of my code I often found that I had to repeat a lot of code. More importantly, I found that I wrote roughly the same texts both in JS Docs as in the help output of CLI commands.

**AutoCLI** is a small library with single function call that will generate a complete CLI for your Node.js project. It just needs to know what source files it should parse for JSDoc, and it will use that to build a model for what commands (functions) can be called, their names, description and accepted parameters. **AutoCLI only works if your source code uses proper JS Doc!**

Similar to: [Python Fire](https://github.com/google/python-fire), [Python Typer](https://github.com/tiangolo/typer)
## How it works

Using [`comment-parser`](https://github.com/syavorsky/comment-parser) we scan Javascript source files for JS Doc comments, and each exported function with a JS Doc block becomes a command. Type expressions are read as plain text, so TypeScript-style types such as `import('./x').Foo` or `{[key: string]: number}` don't break parsing. Let's say you have this function:

```js
// math.js
/**
 *	Adds two numbers.
 *
 * @param {number} a first number
 * @param {number} b second number
 * @returns {number}
 */
exports.adder = function (a, b) {
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
- Can take arguments as JSON encoded text or path to a JSON file with `-d/--data`, and output results as JSON with `-j/--json`
- If provided JSON is an array, it will run the command for each element, so it becomes a simple batch runner for commands
- Converts command line arguments to the types declared in the JS Doc, and rejects values that don't fit (see below)

## Argument types

Values given on the command line (positional or `--option`) are cast based on the `@param` type. Values imported with `-d` are used as is.

| Type | Accepted values |
|---|---|
| `boolean` | `true`/`false` (any case), `--flag` for true and `--no-flag` for false. A flag never takes the next argument as its value, unless it is `true` or `false` |
| `number` | Any number, e.g. `5`, `-1.5` |
| `string` | Kept as given, also when it looks like a number, e.g. `0123` |
| `"a"\|"b"` | One of the listed values |
| `string[]`, `Array<T>` | Comma-separated list, e.g. `a,b`, a JSON array, or the option repeated. Elements are cast to `T` |
| `?T` | Also `null` |
| `object` and other types | JSON if the value starts with `{` or `[`, otherwise passed on as a string. Dotted options like `--query.limit=5` give an object, with values cast like untyped ones |
| untyped, `*` | Numbers are cast, everything else is kept as a string |

Unions try `boolean`, then `number`, then `string`, so `{boolean|string}` gives `true` for `true` and the string otherwise. Options that leave out a value keep the function's default, e.g. `commit` stays `true` for `@param {boolean} [opts.commit=true]` unless given. Unknown options are reported with a warning and ignored. Options without a value (`--limit`) or repeated (`--limit=1 --limit=2`) are rejected unless the type allows it. Negative numbers like `-5` are values, not flags; use `--` before positionals that start with `--`.

Comments are found with [`acorn`](https://github.com/acornjs/acorn), so a JS Doc block documents the declaration on the first code line after it, skipping other comments. Every name assigned on that line, like `exports.a = exports.b = ...`, gets the same docs. Blocks with `@typedef`, `@callback` or `@type` are not command docs.


## Planned features

- Better error messages for improper JS Doc
- Fall back on parsing function signatures if no JS Doc available
- JSON from stdin
- Return a list of promises
- Utilize environment variables
- Correctly return exit codes
- BASH completions

## Requirements

Node.js 20.12 or later.

## Documentation

```js
/**
 * Automatically generates a CLI for given sourcePaths with exported and
 * documented functions. Executes the command and options provided via the argv
 * array.
 *
 * @param {string[]} argv array of command options from `process.argv` 
 * @param {string|string[]|object} sourcePaths path(s) of source files to scan.
 * If an object, each key will denote a group of commands.
 * @param {object} [options={}] the options object
 * @param {string} options.cliName name of the CLI app to display when printing
 * help. Defaults to package.json values from calling module.
 * @param {string} options.cliDescription description of the CLI app to display
 * when printing help. Defaults to package.json values from calling module.
 * @param {string} options.cliVersion version of the CLI app to display when
 * printing help. Defaults to package.json values from calling module.
 * @param {object} options.internalArgs function parameters that should not be
 * exposed in CLI commands but instead populated internally
 * @param {boolean} [options.parallelize=true] if given multiple commands (with
 * -d), run them in parallel. If false, they run in sequence, and a failing command gives its
 * error message as result instead of stopping the others
 * @returns {Promise<any[]>} resolving to an array of command return values
 */
```