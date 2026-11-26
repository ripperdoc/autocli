//@ts-check

/**
 * Parses command line arguments into positionals and options, keeping all values as strings so they
 * can be cast later based on JSDoc types.
 *
 * Supports `--key=value`, `--key value`, `--flag`, `--no-flag`, `-k value`, dotted keys like
 * `--query.limit=5` (giving nested objects), repeated keys (giving arrays) and `--` to end options.
 * Unlike minimist, tokens like `-5` are values rather than flags, and whether `--key` consumes the
 * next token is decided by the caller, so boolean flags never swallow a positional.
 */

/**
 * True if the token is an option, e.g. `--key` or `-k`, but not a negative number like `-5`.
 *
 * @param {string} token
 * @returns {boolean}
 */
function isOption(token) {
    return /^--[^-]/.test(token) || /^-[a-zA-Z]/.test(token);
}

/**
 * Sets an option value at a dot-separated key, collecting repeated keys into an array.
 *
 * @param {Object<string, any>} options
 * @param {string} key
 * @param {any} value
 */
function setOption(options, key, value) {
    const keys = key.split('.');
    const last = keys.pop() || '';
    let obj = options;
    for (const k of keys) {
        if (typeof obj[k] !== 'object' || obj[k] === null || Array.isArray(obj[k]))
            obj[k] = {};
        obj = obj[k];
    }
    if (Object.hasOwn(obj, last))
        obj[last] = [].concat(obj[last], value);
    else
        obj[last] = value;
}

/**
 * @param {string[]} argv arguments, without node and script path
 * @param {(key: string) => boolean} [takesValue] whether `--key` without `=` consumes the next token
 * @returns {{positionals: string[], options: Object<string, any>}}
 */
function parseArgv(argv, takesValue = () => true) {
    /** @type {string[]} */
    const positionals = [];
    /** @type {Object<string, any>} */
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === '--') {
            positionals.push(...argv.slice(i + 1));
            break;
        }
        if (!isOption(token)) {
            positionals.push(token);
            continue;
        }
        const name = token.replace(/^--?/, '');
        const eq = name.indexOf('=');
        if (eq > 0) {
            setOption(options, name.substring(0, eq), name.substring(eq + 1));
        } else if (token.startsWith('--no-')) {
            setOption(options, name.substring(3), false);
        } else if (i + 1 < argv.length && !isOption(argv[i + 1])
            && (takesValue(name) || /^(true|false)$/i.test(argv[i + 1]))) { // Like minimist, `--flag false` works
            setOption(options, name, argv[++i]);
        } else {
            setOption(options, name, true);
        }
    }
    return { positionals, options };
}

module.exports = { parseArgv };
