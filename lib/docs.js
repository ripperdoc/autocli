//@ts-check

const fs = require('fs');
const { parse } = require('comment-parser');

/**
 * @typedef {object} Param
 * @property {string} name may be nested, e.g. `opts.commit`
 * @property {string} type raw type expression, empty if not given
 * @property {boolean} optional
 * @property {string} [defaultValue] raw default value, e.g. `true`
 * @property {string} description
 *
 * @typedef {object} Command
 * @property {string} name
 * @property {Function} func
 * @property {Param[]} params
 * @property {string} description
 */

// The declaration following a JSDoc block, capturing the declared name
const DECLARATION_PATTERNS = [
    /^\s*(?:module\.)?exports\.([\w$]+)\s*=/,
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=/,
];

/**
 * Finds the name declared by the first code line after a JSDoc block.
 *
 * @param {string[]} lines source lines
 * @param {number} fromLine first line after the JSDoc block (0-based)
 * @returns {string|undefined}
 */
function declaredName(lines, fromLine) {
    for (let i = fromLine; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim())
            continue;
        for (const pattern of DECLARATION_PATTERNS) {
            const m = line.match(pattern);
            if (m)
                return m[1];
        }
        return undefined; // Only the first code line counts
    }
    return undefined;
}

/**
 * Parses JSDoc blocks in source code, keyed by the name of the declaration they document.
 *
 * @param {string} source
 * @returns {Object<string, {description: string, params: Param[]}>}
 */
function parseDocs(source) {
    const lines = source.split(/\r?\n/);
    /** @type {Object<string, {description: string, params: Param[]}>} */
    const docs = {};
    for (const block of parse(source)) {
        const name = declaredName(lines, block.source[block.source.length - 1].number + 1);
        if (!name)
            continue;
        docs[name] = {
            description: block.description,
            params: block.tags
                .filter(t => t.tag === 'param' || t.tag === 'arg' || t.tag === 'argument')
                .map(t => ({
                    name: t.name,
                    type: t.type,
                    optional: t.optional,
                    defaultValue: t.default,
                    description: t.description,
                })),
        };
    }
    return docs;
}

/**
 * Makes a map of commands from source files. A command is an exported function with a JSDoc block.
 *
 * @param {string|string[]} sourcePaths
 * @returns {Object<string, Command>} commands keyed by command (function) name
 */
function makeCommands(sourcePaths) {
    /** @type {Object<string, Command>} */
    const commands = {};
    for (const path of [sourcePaths].flat()) {
        const docs = parseDocs(fs.readFileSync(path, 'utf8'));
        const exported = require(path);
        for (const [name, func] of Object.entries(exported)) {
            // Skip exported values that aren't documented functions, such as constants and classes
            if (typeof func !== 'function' || !docs[name] || /^class\b/.test(Function.prototype.toString.call(func)))
                continue;
            let description = docs[name].description.replace(/\s*\n\s*/g, ' ');
            if (description.length > 120)
                description = description.substring(0, 120) + '...';
            commands[name] = { name, func, params: docs[name].params, description };
        }
    }
    return commands;
}

module.exports = { makeCommands, parseDocs };
