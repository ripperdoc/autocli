//@ts-check

const fs = require('fs');
const pathLib = require('path');
const { styleText } = require('util');
const { makeCommands } = require('./lib/docs');
const { castValue, isBooleanType, isAnyType, parseType } = require('./lib/cast');
const { parseArgv } = require('./lib/argv');

/** @typedef {import('./lib/docs').Command} Command */
/** @typedef {import('./lib/docs').Param} Param */

// Options handled by AutoCLI itself, never passed on to commands
const RESERVED_OPTIONS = ['d', 'data', 'j', 'json', 'h', 'help', 'v', 'version'];
const RESERVED_VALUE_OPTIONS = ['d', 'data'];
// Parameter names for an options object, whose properties are given as --option=value
const OPTIONS_PARAMS = ['opts', 'options'];

/**
 * Finds the nearest package.json walking up from a directory.
 *
 * @param {string} dir
 * @returns {object} the parsed package.json, or an empty object if none found
 */
function findPackage(dir) {
    for (let d = dir; ; d = pathLib.dirname(d)) {
        const path = pathLib.join(d, 'package.json');
        if (fs.existsSync(path))
            return JSON.parse(fs.readFileSync(path, 'utf8'));
        if (d === pathLib.dirname(d))
            return {};
    }
}

/**
 * Levenshtein distance between two strings, used to suggest the closest command.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function distance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++)
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}

/**
 * Sets a value at a dot-separated path, creating objects along the way.
 *
 * @param {object} obj
 * @param {string} path e.g. `opts.commit`
 * @param {any} value
 */
function setNested(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop() || '';
    for (const key of keys) {
        if (typeof obj[key] !== 'object' || obj[key] === null)
            obj[key] = {};
        obj = obj[key];
    }
    obj[last] = value;
}

/**
 * Gets a value at a dot-separated path, or undefined if any part is missing.
 *
 * @param {object} obj
 * @param {string} path e.g. `opts.commit`
 * @returns {any}
 */
function getNested(obj, path) {
    return path.split('.').reduce((o, key) => (o && typeof o === 'object' ? o[key] : undefined), obj);
}

/**
 * The name of a parameter as given in an `--option`, e.g. `opts.commit` becomes `commit`.
 *
 * @param {string} paramName
 * @returns {string}
 */
function optionName(paramName) {
    const [root, ...rest] = paramName.split('.');
    return OPTIONS_PARAMS.includes(root) && rest.length ? rest.join('.') : paramName;
}

/**
 * Creates the string to display as help message for a specific command.
 *
 * @param {Command} command
 * @param {string[]} ignoreParams an array of parameter names to ignore for help texts
 * @param {boolean} [showParams=false] whether to display params in the help text or not
 * @returns {string} a help text
 */
function helpString(command, ignoreParams, showParams = false) {
    let fill = showParams || command.name.length >= 24 ? '' : '.'.repeat(24 - command.name.length);
    let s = `${styleText('blueBright', command.name.length >= 24 ? command.name.substring(0, 24) : command.name)}${fill}`;
    if (showParams && command.params)
        s += " " + command.params
            .filter(p => !ignoreParams.includes(p.name))
            .map(p => {
                let name = optionName(p.name);
                let type = p.defaultValue === undefined ? p.type : p.defaultValue;
                type = (!type || type === 'string' || type === '*') ? "" : "=" + type;
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
 * @param {Object<string, Object<string, Command>>} opts.commands
 * @param {object} opts.options
 */
function printHelp({ cmdGroup, cmd, commands, options }) {
    let out = "", search;
    // Remove opts and options for user, this is implied by option style args
    let ignoreParams = Object.keys(options.internalArgs || {}).concat(OPTIONS_PARAMS);
    if (!commands[cmdGroup] || !commands[cmdGroup][cmd]) { // Command doesn't exist or none was given
        if (search = (cmd || cmdGroup)) { // ... but we do have an (incorrect) command string
            // Search for command with closest levenshtein distance (closest string)
            let guesses = Object.keys(commands)
                .flatMap(group => Object.keys(commands[group]).map(name => [group, name]))
                .sort((a, b) => distance(a[1], search) - distance(b[1], search))
            if (guesses.length)
                out += styleText('red', `Did you mean '${guesses[0][0]} ${guesses[0][1]}'?\n\n`);
        }
        const flat = Object.keys(commands).length === 1 && commands.all;
        out += `Usage: ${options.cliName}${flat ? '' : ' GROUP'} COMMAND [ARGUMENTS]\n\n`;
        if (options.cliDescription)
            out += `${options.cliDescription}\n\n`;
        out +=
            'Options:\n' +
            '  -h, --help               Print help text for all commands or specific command\n' +
            '  -d, --data <string|file> Import JSON string or file with argument object or array of such objects\n' +
            '  -j, --json               Output the result as JSON\n' +
            '  -v, --version            Print version information and quit\n\n';
        for (let group of Object.keys(commands).sort()) {
            out += flat ? '\n' : `\nGROUP: ${group}\n\n`;
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

        if (!Object.hasOwn(target, key)) {
            console.warn(styleText('yellow', `Ignoring unknown argument ${key} in imported data`));
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
 * Values from the command line (positional and options) are cast to their JSDoc types.
 *
 * @param {Param[]} cmdParams
 * @param {any[]} [posArgs=[]]
 * @param {object} [optArgs={}]
 * @param {object} [importArgs=undefined]
 * @param {object} [internalArgs={}]
 * @returns {Object<string, any>} argument values keyed by root parameter name, in parameter order
 * @throws {Error} if a command line value doesn't match its declared type
 */
function mergeArgs(cmdParams, posArgs = [], optArgs = {}, importArgs = undefined, internalArgs = {}) {
    // Create an object representing the arguments values. Note that since ES2015, order of keys are
    // chronological, meaning if we put them in at the right parameter order they will also come out in same order
    /** @type {Object<string, any>} */
    let args = {};
    for (const param of cmdParams || [])
        setNested(args, param.name, undefined);
    const typeOf = (/** @type {string} */ name) => cmdParams?.find(p => p.name === name)?.type;

    // First do imported args, e.g. from a JSON or similar. Their strings are cast like command line
    // values, so that e.g. "commit": "false" isn't truthy, but untyped values are kept as given
    if (importArgs) {
        args = mergeDeep(args, importArgs);
        for (const param of cmdParams || []) {
            const value = getNested(args, param.name);
            if (typeof value === 'string' && parseType(param.type).length && !isAnyType(param.type))
                setNested(args, param.name, castValue(value, param.type, param.name));
        }
    }

    // Set arg values from internalArgs, replacing anything imported
    for (let arg in internalArgs) {
        // Only sets root arguments, not nested
        if (Object.hasOwn(args, arg))
            args[arg] = internalArgs[arg]
    }

    // Set arg values from positional args in order, skipping already set args
    let j = 0;
    for (const name of Object.keys(args)) {
        if (j >= posArgs.length)
            break;
        if (args[name] === undefined)
            args[name] = castValue(posArgs[j++], typeOf(name), name);
    }

    // Finally writes any argument options, e.g. --option=x, looking for match first in option/opts, otherwise root arguments
    for (let option in optArgs) {
        const root = OPTIONS_PARAMS.find(p => args[p] && Object.hasOwn(args[p], option));
        if (root) {
            args[root][option] = castValue(optArgs[option], typeOf(`${root}.${option}`), option);
        } else if (Object.hasOwn(args, option)) {
            args[option] = castValue(optArgs[option], typeOf(option), option);
        } else {
            console.warn(styleText('yellow', `Ignoring unknown option --${option}`));
        }
    }

    return args;
}

/**
 * Makes a function telling if an option takes a value, e.g. `--name x`, rather than being a
 * boolean flag, so that flags never swallow the positional argument that follows them.
 *
 * @param {Param[]} [params] params of the command, if known
 * @returns {(key: string) => boolean}
 */
function optionTakesValue(params) {
    return (key) => {
        if (RESERVED_OPTIONS.includes(key))
            return RESERVED_VALUE_OPTIONS.includes(key);
        if (!params)
            return false; // Before the command is known, only reserved options can take values
        const param = params.find(p => optionName(p.name) === key);
        return !param || !isBooleanType(param.type);
    };
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
 * @param {string} [options.cliName] name of the CLI app to display when printing
 * help. Defaults to package.json values from calling module.
 * @param {string} [options.cliDescription] description of the CLI app to display
 * when printing help. Defaults to package.json values from calling module.
 * @param {string} [options.cliVersion] version of the CLI app to display when
 * printing help. Defaults to package.json values from calling module.
 * @param {object} [options.internalArgs] function parameters that should not be
 * exposed in CLI commands but instead populated internally
 * @param {boolean} [options.parallelize=true] if given multiple commands (with
 * -d), run them in parallel. If false, they run in sequence, and a failing command gives its
 * error message as result instead of stopping the others
 * @returns {Promise<any[]|undefined>} resolving to an array of command return values
 */
async function autoCLI(argv, sourcePaths, options = {}) {
    // Find package.json of the script where main is run from, assuming autoCLI is used as a dependency to it
    const callingPackage = require.main ? findPackage(pathLib.dirname(require.main.filename)) : {};

    let script, cmdGroup, cmd;
    [, script, ...argv] = argv // Split argv into script name and arguments
    options.cliName = options.cliName || callingPackage.name || pathLib.basename(script);
    options.cliDescription = options.cliDescription || callingPackage.description;
    options.cliVersion = options.cliVersion || callingPackage.version || "Unversioned";
    options.parallelize = options.parallelize === undefined ? true : options.parallelize;

    // First pass finds the command, second pass parses its arguments based on the command's params
    let { positionals, options: cmdOptions } = parseArgv(argv, optionTakesValue());
    let commands = {};
    if (typeof sourcePaths === 'object' && !Array.isArray(sourcePaths)) {
        // Expect a command group before command
        cmdGroup = positionals.shift();
        cmd = positionals.shift();
        for (let key in sourcePaths) {
            commands[key] = makeCommands(sourcePaths[key]);
        }
    } else {
        cmdGroup = "all";
        cmd = positionals.shift();
        commands = { all: makeCommands(sourcePaths) };
    }
    if (cmdOptions.v || cmdOptions.version) {
        console.log(options.cliVersion);
    } else if (cmdOptions.h || cmdOptions.help || !commands[cmdGroup] || !commands[cmdGroup][cmd]) {
        printHelp({ cmdGroup, cmd, commands, options });
    } else {
        const command = commands[cmdGroup][cmd];
        ({ positionals, options: cmdOptions } = parseArgv(argv, optionTakesValue(command.params)));
        positionals.splice(0, cmdGroup === "all" ? 1 : 2); // Remove group and command
        let importObj, importArgs = [undefined];

        // Remove all properties that are not intended for the command
        const { j, json, d, data } = cmdOptions;
        const optArgs = Object.fromEntries(Object.entries(cmdOptions).filter(([key]) => !RESERVED_OPTIONS.includes(key)));

        if (importObj = (data || d)) {
            if (typeof importObj !== 'string')
                throw new Error('Option --data requires a JSON string or path to a .json file');
            if (importObj.match(/\.json$/))
                importObj = require(pathLib.isAbsolute(importObj) ? importObj : pathLib.join(process.cwd(), importObj));
            else
                importObj = JSON.parse(importObj);
            // An array is a batch job, each element is the arguments of one command
            importArgs = [].concat(importObj);
            if (!importArgs.length || importArgs.some(a => typeof a !== 'object' || a === null || Array.isArray(a)))
                throw new Error('Option --data must be a JSON object, or an array of objects for a batch');
        }
        // Merging also validates all arguments, before any command runs
        let mergedArgs = importArgs.map(a => mergeArgs(command.params, positionals, optArgs, a, options.internalArgs));
        let result;
        if (options.parallelize) {
            result = await Promise.all(mergedArgs.map(args => command.func.apply(null, Object.values(args))));
        } else {
            result = [];
            for (let args of mergedArgs) {
                try {
                    result.push(await command.func.apply(null, Object.values(args)));
                } catch (e)
                {
                    result.push(e.toString());
                }
            }
        }
        if (j || json) {
            return [JSON.stringify(result)];
        } else {
            return result;
        }
    }
}

module.exports = { autoCLI, makeCommands, mergeArgs };
