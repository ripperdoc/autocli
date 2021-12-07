//@ts-check

const jsdoc = require('jsdoc-api');
const pathLib = require('path');
const minimist = require('minimist');
const chalk = require('chalk');
const leven = require('leven');
const nestedProp = require("nested-property");
const pkgUp = require('pkg-up');

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
    let functionDocs = jsdoc.explainSync({ files: sourcePaths, cache: true })
        .filter(o => o.kind === 'function')
        .reduce((obj, o) => { obj[o.name] = o; return obj; }, {});
    // Require (import) all source files found to a map of (exported) functions
    let commands = Object.values(functionDocs)
        .reduce((obj, o) => { return { ...obj, ...require(pathLib.join(o.meta.path, o.meta.filename)) } }, {});
    // For each exported function, enhance with functionDocs
    for (let key in commands) {
        if (!functionDocs[key]) {
            delete commands[key]; // require() can introduce other undocumented exported variables, ignore those
            continue;
        }
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
    let fill = showParams || command.name.length >= 24 ? '' : '.'.repeat(24 - command.name.length);
    let s = `${chalk.blueBright(command.name.length >= 24 ? command.name.substring(0, 24) : command.name)}${fill}`;
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
        s += ` ${command.description.replace(/ ?\n ?/, " ")}`;

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
                    Object.keys(commands[cur]).map(el => [cur, el])), [])
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
    let args = cmdParams ? cmdParams.reduce((obj, param) => { nestedProp.set(obj, param.name, undefined); return obj }, {}) : [];

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
 * @param {object} options.minimistOpts specific options to minimist that is
 * used to parse command arguments
 * @param {object} options.internalArgs function parameters that should not be
 * exposed in CLI commands but instead populated internally
 * @param {boolean} [options.parallelize=true] if given multiple commands (with
 * -j), run them in parallel
 * @returns {Promise<any[]>} resolving to an array of command return values
 */
async function autoCLI(argv, sourcePaths, options = {}) {
    // Find package.json of the script where main is run from, assuming autoCLI is used as a dependency to it
    let callingPackagePath = pkgUp.sync({ cwd: require.main.filename }), callingPackage = {};
    callingPackage = callingPackagePath ? require(callingPackagePath) : callingPackage;

    let script, cmdGroup, cmd;
    [, script, ...argv] = argv // Split argv into script name and arguments
    options.cliName = options.cliName || callingPackage.name || pathLib.basename(script);
    options.cliDescription = options.cliDescription || callingPackage.description;
    options.cliVersion = options.cliVersion || callingPackage.version;
    options.parallelize = options.parallelize === undefined ? true : options.parallelize;

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
        let importObj, importArgs = [undefined], results = [];

        // Remove all properties that are not intended for the command
        let { _, j, json, d, data, h, help, v, version, ...optArgs } = cmdArgs;

        if (importObj = (data || d)) {
            if (importObj.match(/\.json$/))
                importObj = require(pathLib.isAbsolute(importObj) ? importObj : pathLib.join(process.cwd(), importObj));
            else
                importObj = JSON.parse(importObj);
            if (Array.isArray(importObj)) {
                // We have a batch job, each array element is one command
                importArgs = importObj;
            } else {
                importArgs[0] = importObj;
            }
        }
        let mergedArgs = importArgs.map(a => mergeArgs(commands[cmdGroup][cmd].params, _, optArgs, a, options.internalArgs));
        let result;
        if (options.parallelize) {
            result = await Promise.all(mergedArgs.map(args => commands[cmdGroup][cmd].func.apply(null, Object.values(args))));
        } else {
            result = [];
            for (let args of mergedArgs) {
                result.push(await commands[cmdGroup][cmd].func.apply(null, Object.values(args)));
            }
        }
        if (j || json) {
            return [JSON.stringify(result)];
        } else {
            return result;
        }
    }
}

module.exports = { autoCLI }