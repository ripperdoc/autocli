//@ts-check

const fs = require('fs');
const acorn = require('acorn');
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

// Blocks with these tags document types rather than the declaration that follows
const TYPE_TAGS = ['typedef', 'callback', 'type'];
const PARAM_TAGS = ['param', 'arg', 'argument'];

/**
 * Finds the JSDoc block comments in source code, using a real parser so that e.g. `/**` inside
 * strings or a one-line block followed by code are handled correctly.
 *
 * @param {string} source
 * @returns {{text: string, end: number}[]} comment text including delimiters, and end offset
 */
function findDocComments(source) {
    /** @type {{text: string, end: number}[]} */
    const comments = [];
    const onComment = (/** @type {boolean} */ block, /** @type {string} */ text, /** @type {number} */ start, /** @type {number} */ end) => {
        if (block && text.startsWith('*') && !text.startsWith('**'))
            comments.push({ text: source.substring(start, end), end });
    };
    const parseOptions = {
        ecmaVersion: /** @type {const} */ ('latest'),
        allowHashBang: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        onComment,
    };
    try {
        acorn.parse(source, { ...parseOptions, sourceType: 'script' });
    } catch (e) {
        comments.length = 0;
        acorn.parse(source, { ...parseOptions, sourceType: 'module' });
    }
    return comments;
}

/**
 * Finds the names declared by the first code line after a JSDoc block, skipping other comments.
 * Returns no names if another JSDoc block comes first, as that one documents the declaration.
 *
 * @param {string} source
 * @param {number} from offset just after the JSDoc block
 * @returns {string[]} e.g. `['a', 'b']` for `exports.a = exports.b = function () {}`
 */
function declaredNames(source, from) {
    let rest = source.substring(from);
    for (;;) {
        rest = rest.trimStart();
        if (rest.startsWith('//'))
            rest = rest.substring(rest.indexOf('\n') + 1 || rest.length);
        else if (rest.startsWith('/*') && !rest.startsWith('/**'))
            rest = rest.substring(rest.indexOf('*/') + 2 || rest.length);
        else
            break;
    }
    if (rest.startsWith('/**'))
        return [];
    const line = rest.split(/\r?\n/, 1)[0];
    const names = [...line.matchAll(/(?:^|[^\w$.])(?:module\.)?exports\.([\w$]+)\s*=(?!=)/g)].map(m => m[1]);
    const declaration = line.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(/)
        || line.match(/^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=/);
    if (declaration)
        names.push(declaration[1]);
    return names;
}

/**
 * Parses JSDoc blocks in source code, keyed by the name of the declaration they document.
 *
 * @param {string} source
 * @param {string} [path] used in warnings
 * @returns {Object<string, {description: string, params: Param[]}>}
 */
function parseDocs(source, path = 'source') {
    /** @type {Object<string, {description: string, params: Param[]}>} */
    const docs = {};
    for (const comment of findDocComments(source)) {
        const names = declaredNames(source, comment.end);
        const [block] = parse(comment.text);
        if (!names.length || !block || block.tags.some(t => TYPE_TAGS.includes(t.tag)))
            continue;
        const params = [];
        for (const t of block.tags.filter(t => PARAM_TAGS.includes(t.tag))) {
            if (!t.name || t.problems.length) {
                console.warn(`Ignoring invalid @${t.tag} '${t.source[0].source.trim()}' for ${names[0]} in ${path}`);
                continue;
            }
            params.push({
                name: t.name,
                type: t.type.replace(/\s+/g, ' '),
                optional: t.optional,
                defaultValue: t.default,
                description: t.description.replace(/^-\s*/, ''),
            });
        }
        for (const name of names)
            docs[name] = { description: block.description, params };
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
        const docs = parseDocs(fs.readFileSync(path, 'utf8'), path);
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
