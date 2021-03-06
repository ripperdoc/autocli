//@ts-check

const jsdoc = require('jsdoc-api');
const pathLib = require('path');
const minimist = require('minimist');
const chalk = require('chalk');
const leven = require('leven');
const nestedProp = require("nested-property");

/**
 * Finds the string between a balanced pair of symbols, e.g. opening and closing bracket.
 *
 * @param {string} s
 * @param {string} startSymbol
 * @param {string} endSymbol
 * @returns {string}
 */
function findBalancedPair(s, startSymbol, endSymbol) {
    let start = s.indexOf(startSymbol), pos = start, openSymbols = 1, cur;
    if (start === -1)
        return ""
    // console.log(`Opened at ${pos}`);
    while (openSymbols > 0 && pos < s.length) {
        pos++;
        cur = s.substring(pos, pos + 1);
        if (cur === startSymbol) {
            openSymbols++;
            // console.log(`Opened at ${pos}`);
        } else if (cur === endSymbol) {
            openSymbols--;
            // console.log(`Closed at ${pos}`);
        }
    }
    if (openSymbols > 0) {
        // console.error(`Did not find closing ${endSymbol} from ${startSymbol} at ${start}`);
        throw Error(`Did not find closing ${endSymbol} from ${startSymbol} at ${start}`);
    }
    return s.substring(start + 1, pos - 1);
}

/**
 * Attempts to return details about a function, like params, by parsing the function signature.
 *
 * @param {Function} func
 */
function parseFunction(func) {
    let s;
    if (typeof func === 'string') {
        s = func
    } else {
        s = func.toString();
    }
    s = findBalancedPair(s, "(", ")"); // function x(...) or (...) =>
    // s = s.replace(/\/\*.*\*\//g, '') // Remove inline comments
    // Parameters may look like
    // '' <- no params
    // 'a' <- just one param
    // 'a, b, c' <- comma-separated params, any kind of whitespace in between
    // 'a = 1, b = 2' <- default values
    // 'a, {b, c = 1} <- destructured object
    // 'a, {b, {c = 1}, d = 2}' <- nested destructured object
    // '
    if (s) {
        let argsToDefine = s.split(/[,{}]+/).map(arg => arg.trim()).filter(arg => arg && arg.indexOf("=") === -1);
        let toEval = argsToDefine.length > 0 ? `var ${argsToDefine};` : '';
        toEval += `var outputArgs = [${s}]`;
        console.log(toEval);
        eval(toEval);
    }
}

/**
 * Makes a map of commands based on source files paths to scan. It will scan for all
 * functions with valid JSDoc and that also are exported.
 *
 * @param {array} sourcePaths
 * @returns {object} a map of command objects, keyed by command (function) name
 */
function makeCommands(sourcePaths) {
    let functionDocs = jsdoc.explainSync({ files: sourcePaths })
        .filter(o => o.kind === 'function')
        .reduce((obj, o) => { obj[o.name] = o; return obj; }, {});
    // Require (import) all source files found to a map of (exported) functions
    let commands = Object.values(functionDocs)
        .reduce((obj, o) => { return { ...obj, ...require(pathLib.join(o.meta.path, o.meta.filename)) } }, {});
    // For each exported function, enhance with functionDocs
    for (let key in commands) {
        let desc = (functionDocs[key].description || "").replace('\n', ' ');
        if (desc.length > 120)
            desc = desc.substring(0, 120) + '...'
        commands[key] = {
            name: key,
            func: commands[key],
            params: functionDocs[key].params,
            description: desc
        }
    }
    return commands;
}

/**
 * Creates the string to display as help message for a specific command.
 *
 * @param {object} command a command object as created by makeCommands
 * @param {string[]} ignoreParams an array of parameter names to ignore for help texts
 * @param {boolean} [showParams=false] whether to display params in the help text or not
 * @returns {string} a help text
 */
function helpString(command, ignoreParams, showParams = false) {
    let fill = showParams ? '' : '.'.repeat(24 - command.name.length);
    let s = `${chalk.blueBright(command.name)}${fill}`;
    if (showParams && command.params)
        s += " " + command.params
            .filter(p => ignoreParams.indexOf(p.name) < 0)
            .map(p => {
                let name = p.name.replace(/(opts|options)\./, '');
                let type = p.defaultvalue === undefined ? p.type.names.join('|') : p.defaultvalue;
                type = (type === 'string' || type === '*') ? "" : "=" + type;
                if (name !== p.name) {
                    return `--${name}${type}`
                } else {
                    return `<${name}${type}>`
                }
            })
            .join(' ') + '\n\n';

    if (command.description)
        s += ` ${command.description}`;

    s += '\n';
    return s;
}

/**
 * Prints help for all commands given, which may be the full cmd tree or parts of it.
 *
 * @param {object} opts
 * @param {string} opts.cmdGroup
 * @param {string} opts.cmd
 * @param {object} opts.commands
 * @param {object} opts.options
 * {cmd, cmdGroup, cmds, options}
 */
function printHelp({ cmdGroup, cmd, commands, options }) {
    let out = "", search;
    // Remove opts and options for user, this is implied by option style args
    let ignoreParams = Object.keys(options.internalArgs).concat(['opts', 'options']);
    if (!commands[cmdGroup] || !commands[cmdGroup][cmd]) { // Command doesn't exist or none was given
        if (search = (cmd || cmdGroup)) { // ... but we do have an (incorrect) command string
            // Search for command with closest levenshtein distance (closest string)
            let guesses = Object.keys(commands)
                .reduce((prev, cur) => prev.concat(
                    Object.keys(commands[cur]).map(el => [cur, el] )), [])
                .sort((a, b) => leven(a[1], search) - leven(b[1], search))
            out += chalk.red(`Did you mean '${guesses[0][0]} ${guesses[0][1]}'?\n\n`);
        }
        out += `Usage: ${options.cliName}` + ' GROUP COMMAND [ARGUMENTS]\n\n';
        if (options.cliDescription)
            out += `${options.cliDescription}\n\n`;
        out +=
            'Options:\n' +
            '  -h, --help               Print help text for all commands or specific command\n' +
            '  -j, --json <string|file> Import JSON string or file with argument object or array of such objects\n' +
            '  -v, --version            Print version information and quit\n\n';
        for (let group of Object.keys(commands).sort()) {
            out += `\nGROUP: ${group}\n\n`;
            out += Object.values(commands[group])
                .sort((a, b) => a.name.localeCompare(b.name))
                .reduce((s, cmd) => s + "  " + helpString(cmd, ignoreParams), "");
        }
    } else { // cmd exists, just give info on that
        out += helpString(commands[cmdGroup][cmd], ignoreParams, true);
    }

    console.log(out);
}

/**
 * Performs a deep merge of `source` into `target`.
 * Mutates `target` only but not its objects and arrays.
 *
 * @param {object} target
 * @param {object} source
 * @author inspired by [jhildenbiddle](https://stackoverflow.com/a/48218209).
 */
function mergeDeep(target, source) {
    const isObject = (obj) => obj && typeof obj === 'object';

    if (!isObject(target) || !isObject(source)) {
        return source;
    }

    Object.keys(source).forEach(key => {
        const targetValue = target[key];
        const sourceValue = source[key];

        if (!target.hasOwnProperty(key)) {
            console.log(`Skipping key ${key} not in`, target);
            return;  // Skip if source doesn't have key
        } else if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
            target[key] = targetValue.concat(sourceValue);
        } else if (isObject(targetValue) && isObject(sourceValue)) {
            target[key] = mergeDeep(Object.assign({}, targetValue), sourceValue);
        } else {
            target[key] = sourceValue;
        }
    });

    return target;
}

/**
 * Merges arguments from different sources in a particular order to form a final arguments object.
 *
 * @param {array} cmdParams
 * @param {array} [posArgs=[]]
 * @param {object} [optArgs={}]
 * @param {object} [importArgs=undefined]
 * @param {object} [internalArgs={}]
 * @returns
 */
function mergeArgs(cmdParams, posArgs = [], optArgs = {}, importArgs = undefined, internalArgs = {}) {
    // Filter out positional arguments and options not associated with a command
    // Create an object representing the arguments values. Note that since ES2015, order of keys are
    // chronological, meaning if we put them in at the right parameter order they will also come out in same order
    let args = cmdParams.reduce((obj, param) => { nestedProp.set(obj, param.name, undefined); return obj }, {})

    // console.log("Args from start", args)

    // First do imported args, e.g. from a JSON or similar
    if (importArgs) {
        args = mergeDeep(args, importArgs);
        // console.log("Args after json", args)
    }

    // Set arg values from internalArgs, replacing anything imported
    for (let arg in internalArgs) {
        // Only sets root arguments, not nested
        if (args.hasOwnProperty(arg))
            args[arg] = internalArgs[arg]
    }

    // console.log("Args after internal", args)

    // Set arg values from positional args in order, skipping already set args
    if (posArgs.length) {
        let entries = Object.entries(args);
        for (let i = 0, j = 0; i < entries.length && j < posArgs.length; i++) {
            if (entries[i][1] === undefined) {
                entries[i][1] = posArgs[j];
                j++;
            }
        }
        args = entries.reduce((tempArgs, entry) => {
            tempArgs[entry[0]] = entry[1];
            return tempArgs;
        }, {})
        // console.log("Args after positional", args)
    }

    // Finally writes any argument options, e.g. --option=x, looking for match first in option/opts, otherwise root arguments
    for (let option in optArgs) {
        if (args.opts && args.opts.hasOwnProperty(option)) {
            args.opts[option] = optArgs[option];
        } else if (args.options && args.options.hasOwnProperty(option)) {
            args.options[option] = optArgs[option];
        } else if (args.hasOwnProperty(option)) {
            args[option] = optArgs[option];
        }
    }
    // console.log("Args after options", args)

    return args;
}

/**
 * Automatically generates a CLI for given sourcePaths with exported and documented functions.
 * Executes the command and options provided via the argv array.
 *
 * @param {string[]} argv array of command options (such as from `process.argv`) 
 * @param {string|string[]|object} sourcePaths
 * @param {object} [options={}]
 * @param {Function} options.paramCb
 * @param {string} options.cliName
 * @param {string} options.cliDescription
 * @param {string} options.cliVersion
 * @param {object} options.minimistOpts
 * @param {object} options.internalArgs
 * @returns
 */
async function autoCLI(argv, sourcePaths, options = {}, packageObject = {}) {
    let script, cmdGroup, cmd, result;
    [, script, ...argv] = argv // Split argv into script name and arguments
    options.cliName = options.cliName || packageObject.name || pathLib.basename(script);
    options.cliDescription = options.cliDescription || packageObject.description;
    options.cliVersion = options.cliVersion || packageObject.version;

    let cmdArgs = minimist(argv, options.minimistOpts || {});
    let commands = {};
    if (typeof sourcePaths === 'object') {
        // Expect a command group before command
        cmdGroup = cmdArgs._.shift();
        cmd = cmdArgs._.shift();
        for (let key in sourcePaths) {
            commands[key] = makeCommands(sourcePaths[key]);
        }
    } else {
        cmdGroup = "all";
        cmd = cmdArgs._.shift();
        commands = { all: makeCommands(sourcePaths) };
    }
    if (cmdArgs.v || cmdArgs.version) {
        console.log(options.cliVersion);
    } else if (cmdArgs.h || cmdArgs.help || !commands[cmdGroup] || !commands[cmdGroup][cmd]) {
        printHelp({ cmdGroup, cmd, commands, options });
    } else {
        // TODO maybe re-parse argv as we can cast some options based on command param types
        // args is an array. It can take values from internalArgs, from cmdArgs and from JSON input.
        // as it's an array, we have to deal with the index. We might have an internalArg at index 2,
        // but a named positional argument at index 0, or vice versa
        let jsonObj, importArgs = [undefined], results = [];

        // Remove all properties that are not intended for the command
        let { _, j, json, h, help, v, version, ...optArgs } = cmdArgs;
        if (jsonObj = (json || j)) {
            jsonObj = jsonObj.match(/\.json$/) ? require(__dirname + "/../" + jsonObj) : JSON.parse(jsonObj);
            if (Array.isArray(jsonObj)) {
                // We have a batch job, each array element is one command
                importArgs = jsonObj;
            } else {
                importArgs[0] = jsonObj;
            }
        }

        for (let importArg of importArgs) {
            let args = mergeArgs(commands[cmdGroup][cmd].params, _, optArgs, importArg, options.internalArgs);
            // results.push(args);
            results.push(await Promise.resolve(commands[cmdGroup][cmd].func.apply(null, Object.values(args))));
        }

        console.log(results)
        return results;
    }
    return;
}

module.exports = { autoCLI }