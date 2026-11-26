//@ts-check

/**
 * Casts CLI string values to the types declared in JSDoc `@param {type}` expressions.
 *
 * Type expressions are kept as raw strings (JSDoc, Closure or TypeScript flavoured) and only the
 * parts needed for casting are interpreted. Unknown types never fail, they are passed through.
 */

// Same pattern minimist uses to auto-cast values, kept for untyped params for backward compatibility
const NUMBER_PATTERN = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$|^0x[0-9a-f]+$/i;
const ANY_TYPES = ['*', 'any', 'unknown', '?', ''];
const STRING_LITERAL = /^(['"`])(.*)\1$/;

/**
 * Splits a string on a separator, but only at the top level (outside brackets and quotes).
 *
 * @param {string} s
 * @param {string} separator a single character
 * @returns {string[]}
 */
function splitTopLevel(s, separator) {
    const parts = [];
    let depth = 0, quote = '', start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            if (c === quote) quote = '';
        } else if (c === '"' || c === "'" || c === '`') {
            quote = c;
        } else if ('<({['.includes(c)) {
            depth++;
        } else if ('>)}]'.includes(c) && !(c === '>' && s[i - 1] === '=')) { // Ignore => in arrow types
            depth--;
        } else if (c === separator && depth === 0) {
            parts.push(s.substring(start, i));
            start = i + 1;
        }
    }
    parts.push(s.substring(start));
    return parts.map(p => p.trim()).filter(p => p);
}

/**
 * Parses a type expression into a list of union members.
 *
 * @param {string} [type] e.g. `?string|Array<number>=`
 * @returns {string[]} union members, e.g. `['string', 'Array<number>', 'null']`, empty if untyped
 */
function parseType(type) {
    let t = (type || '').trim();
    // Optional suffix, non-nullable prefix and wrapping parens carry no casting information
    const nullable = t.startsWith('?') && t.length > 1;
    t = t.replace(/^[?!]/, '').replace(/=$/, '').trim();
    if (t.startsWith('(') && t.endsWith(')') && splitTopLevel(t, '|').length === 1)
        t = t.slice(1, -1);
    const members = splitTopLevel(t, '|');
    return nullable ? [...members, 'null'] : members;
}

/**
 * Returns the element type if the given type is an array type, otherwise undefined.
 *
 * @param {string} member a single union member
 * @returns {string|undefined} element type, `*` if not given
 */
function arrayElementType(member) {
    if (member.endsWith('[]'))
        return member.slice(0, -2);
    const m = member.match(/^Array(?:\.?<(.*)>)?$/);
    if (m)
        return m[1] || '*';
    return undefined;
}

/**
 * True if the type accepts a boolean, so that `--flag` is a complete option that doesn't take the
 * next command line argument as its value.
 *
 * @param {string} [type]
 * @returns {boolean}
 */
function isBooleanType(type) {
    return parseType(type).some(m => m === 'boolean' || m === 'Boolean');
}

/**
 * True if the type accepts anything, e.g. `*`, so values can't be cast by type.
 *
 * @param {string} [type]
 * @returns {boolean}
 */
function isAnyType(type) {
    return parseType(type).some(m => ANY_TYPES.includes(m));
}

/**
 * Casts each leaf string of a nested object like untyped values, as for `--query.limit=5`.
 *
 * @param {any} value
 * @returns {any}
 */
function castLeaves(value) {
    if (typeof value === 'string')
        return castValue(value);
    if (Array.isArray(value))
        return value.map(castLeaves);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, castLeaves(v)]));
    return value;
}

/**
 * Casts a value given on the command line to the declared type. Besides strings, the value can be
 * a boolean (`--flag`, `--no-flag`), an array (repeated option) or an object (dotted option).
 *
 * @param {any} value
 * @param {string} [type] JSDoc type expression
 * @param {string} [name] parameter name, used in error messages
 * @returns {any}
 * @throws {Error} if the value cannot represent the declared type
 */
function castValue(value, type, name = 'argument') {
    const members = parseType(type);
    const has = (/** @type {string[]} */ ...names) => members.some(m => names.includes(m));
    const untyped = members.length === 0 || has(...ANY_TYPES);
    const elementType = members.map(arrayElementType).find(t => t !== undefined);

    if (typeof value === 'boolean') {
        if (untyped || has('boolean', 'Boolean'))
            return value;
        throw new Error(`Missing value for ${name}, expected ${type}`);
    }
    if (Array.isArray(value)) {
        if (untyped)
            return value.map(castLeaves);
        if (elementType !== undefined)
            return value.flatMap(v => castValue(v, `${elementType}[]`, name));
        throw new Error(`Multiple values for ${name}, expected ${type}`);
    }
    if (value && typeof value === 'object')
        return castLeaves(value);
    if (typeof value !== 'string')
        return value;

    if (untyped)
        return NUMBER_PATTERN.test(value) ? Number(value) : value;
    if (has('boolean', 'Boolean') && /^(true|false)$/i.test(value))
        return value.toLowerCase() === 'true';
    if (has('number', 'Number', 'integer', 'bigint') && value.trim() !== '' && !Number.isNaN(Number(value)))
        return Number(value);
    if (has('string', 'String'))
        return value;

    const literals = members.map(m => m.match(STRING_LITERAL)).filter(m => m).map(m => m && m[2]);
    if (literals.includes(value))
        return value;
    if (has('null') && value === 'null')
        return null;

    if (elementType !== undefined) {
        if (value.trim().startsWith('['))
            return [].concat(parseJSON(value, name)).map(v => typeof v === 'string' ? castValue(v, elementType, name) : v);
        return value.split(/\s*,\s*/).filter(v => v !== '').map(v => castValue(v, elementType, name));
    }

    const isPrimitiveOnly = members.every(m =>
        ['boolean', 'Boolean', 'number', 'Number', 'integer', 'bigint', 'null', 'undefined'].includes(m)
        || STRING_LITERAL.test(m));
    if (isPrimitiveOnly) {
        const expected = literals.length ? `one of ${literals.join(', ')}` : `of type ${type}`;
        throw new Error(`Invalid value '${value}' for ${name}, expected ${expected}`);
    }

    // Objects and other (unknown or custom) types: parse JSON if it looks like it, otherwise pass on
    // the string, as some functions accept their own string formats for objects
    if (/^\s*[{[]/.test(value))
        return parseJSON(value, name);
    return value;
}

/**
 * @param {string} value
 * @param {string} name
 * @returns {any}
 */
function parseJSON(value, name) {
    try {
        return JSON.parse(value);
    } catch (e) {
        throw new Error(`Invalid JSON for ${name}: ${e.message}`);
    }
}

module.exports = { castValue, parseType, isBooleanType, isAnyType, splitTopLevel };
