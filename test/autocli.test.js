const { test } = require('node:test');
const assert = require('node:assert/strict');
const pathLib = require('path');
const { autoCLI } = require('../autocli');
const { makeCommands } = require('../lib/docs');

const FIXTURE = pathLib.join(__dirname, 'fixtures/commands.js');
const INTERNAL = { internal: 'injected' };

/** Runs a command line against the fixture and returns the single result. */
async function run(cmdLine) {
    const argv = ['node', 'cli.js', ...cmdLine.split(' ').filter(a => a)];
    const results = await autoCLI(argv, { things: FIXTURE }, { internalArgs: INTERNAL });
    return results[0];
}

test('only documented exported functions become commands', () => {
    assert.deepEqual(Object.keys(makeCommands(FIXTURE)).sort(), ['copyThing', 'modernTypes', 'untyped']);
});

test('TypeScript-style type expressions are parsed without failing', () => {
    const { params } = makeCommands(FIXTURE).modernTypes;
    assert.deepEqual(params.map(p => p.type), ["import('./types').Thing", '{[key: string]: number}', 'boolean']);
});

test('boolean defaults are kept when the flag is left out', async () => {
    assert.equal((await run('things copyThing abc')).commit, true);
});

test('boolean options are cast from any style of flag', async () => {
    assert.equal((await run('things copyThing abc --commit=false')).commit, false);
    assert.equal((await run('things copyThing abc --commit false')).commit, false);
    assert.equal((await run('things copyThing abc --no-commit')).commit, false);
    assert.equal((await run('things copyThing abc --commit')).commit, true);
});

test('invalid values fail before the command runs', async () => {
    await assert.rejects(run('things copyThing abc --commit=yes'), /Invalid value 'yes' for commit/);
    await assert.rejects(run('things copyThing abc --format=xml'), /expected one of json, csv/);
});

test('positional and option values are cast to their types', async () => {
    const result = await run('things copyThing 0123 --limit=5 --tags=a,b --query={"x":1}');
    assert.deepEqual(result, {
        internal: 'injected', id: '0123', commit: true, limit: 5, tags: ['a', 'b'], format: 'json', query: { x: 1 },
    });
});

test('positional booleans are cast', async () => {
    assert.equal((await run('things modernTypes thing {"a":1} false')).dryRun, false);
});

test('JSON imported arguments are kept as given', async () => {
    // With -j, results are returned as a JSON string of all results
    const [result] = JSON.parse(await run('things copyThing -j {"id":"x","opts":{"commit":false}}'));
    assert.equal(result.id, 'x');
    assert.equal(result.commit, false);
});
