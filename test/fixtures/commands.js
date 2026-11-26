// Fixture module with documented commands, using a mix of declaration styles and type expressions

/**
 * Copies a thing, committing by default.
 * @param {object} internal populated by internalArgs
 * @param {string} id
 * @param {object} [opts]
 * @param {boolean} [opts.commit=true]
 * @param {number} [opts.limit]
 * @param {string[]} [opts.tags]
 * @param {"json"|"csv"} [opts.format="json"]
 * @param {object} [opts.query]
 * @returns {object}
 */
exports.copyThing = function (internal, id, { commit = true, limit, tags, format = 'json', query } = {}) {
    return { internal, id, commit, limit, tags, format, query };
};

/**
 * Uses a TypeScript-style type that classic jsdoc can't parse.
 * @param {import('./types').Thing} thing
 * @param {{[key: string]: number}} [counts]
 * @param {boolean} [dryRun]
 */
async function modernTypes(thing, counts, dryRun) {
    return { thing, counts, dryRun };
}

/**
 * @param {*} value
 */
exports.untyped = (value) => value;

exports.undocumented = () => 'hidden';

/**
 * Classes are not commands.
 */
exports.Thing = class Thing {};

/**
 * Not exported, so not a command.
 */
function notExported() {}

exports.modernTypes = modernTypes;
