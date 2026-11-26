const { test } = require('node:test');
const assert = require('node:assert/strict');
const pathLib = require('path');
const { autoCLI } = require('../autocli');

const FIXTURE = pathLib.join(__dirname, 'fixtures/commands.js');
const BATCH = pathLib.join(__dirname, 'fixtures/batch.json');
const INTERNAL = { internal: 'injected' };

/** Runs a command line against the fixture as a command group and returns all results. */
function runAll(cmdLine, options = {}) {
    const argv = ['node', 'cli.js', ...cmdLine.split(' ').filter(a => a)];
    return autoCLI(argv, { things: FIXTURE }, { internalArgs: INTERNAL, ...options });
}

/** Runs a single command line and returns its result. */
async function run(cmdLine) {
    return (await runAll(cmdLine))[0];
}

/** Runs and returns everything printed with console.log, and the warnings. */
async function output(t, argv, sourcePaths = { things: FIXTURE }, options = {}) {
    const log = t.mock.method(console, 'log', () => {});
    const warn = t.mock.method(console, 'warn', () => {});
    await autoCLI(['node', 'cli.js', ...argv], sourcePaths, { internalArgs: INTERNAL, ...options });
    const text = (mock) => mock.mock.calls.map(c => c.arguments.join(' ')).join('\n');
    return { log: text(log), warn: text(warn) };
}

test('boolean defaults are kept when the flag is left out', async () => {
    assert.equal((await run('things copyThing abc')).commit, true);
});

test('boolean options are cast from any style of flag', async () => {
    assert.equal((await run('things copyThing abc --commit=false')).commit, false);
    assert.equal((await run('things copyThing abc --commit false')).commit, false);
    assert.equal((await run('things copyThing abc --no-commit')).commit, false);
    assert.equal((await run('things copyThing abc --commit')).commit, true);
});

test('a boolean flag before a positional does not take it as value', async () => {
    assert.deepEqual(await run('things modernTypes --dryRun thing'), { thing: 'thing', counts: undefined, dryRun: true });
});

test('invalid values fail before the command runs', async () => {
    await assert.rejects(run('things copyThing abc --commit=yes'), /Invalid value 'yes' for commit/);
    await assert.rejects(run('things copyThing abc --format=xml'), /expected one of json, csv/);
    await assert.rejects(run('things copyThing abc --limit'), /Missing value for limit/);
});

test('string options stay strings, even when they look like numbers', async () => {
    assert.equal((await run('things copyThing --id=0123')).id, '0123');
    assert.deepEqual((await run('things copyThing x --tags=0123')).tags, ['0123']);
});

test('number options and negative positionals are cast', async () => {
    assert.equal((await run('things copyThing x --limit=5')).limit, 5);
    await assert.rejects(run('things failNegative -5'), /Negative value/);
});

test('object options take JSON or dotted options', async () => {
    assert.deepEqual((await run('things copyThing x --query={"a":1}')).query, { a: 1 });
    assert.deepEqual((await run('things copyThing x --query.limitToFirst=5')).query, { limitToFirst: 5 });
});

test('options can be given to a param named options', async () => {
    assert.deepEqual(await run('things withOptions 3 --label=x'), { amount: 3, label: 'x' });
});

test('unknown options are ignored with a warning', async (t) => {
    const { warn } = await output(t, ['things', 'copyThing', 'x', '--comit']);
    assert.match(warn, /Ignoring unknown option --comit/);
});

test('-d imports arguments, and internal args override them', async () => {
    const [result] = await runAll('things copyThing -d {"internal":"x","id":"a"}');
    assert.equal(result.internal, 'injected');
    assert.equal(result.id, 'a');
});

test('-d casts imported strings by type, like command line values', async () => {
    const [result] = await runAll('things copyThing -d {"id":"0123","opts":{"commit":"false","limit":"5","tags":"a,b"}}');
    assert.deepEqual([result.id, result.commit, result.limit, result.tags], ['0123', false, 5, ['a', 'b']]);
    await assert.rejects(runAll('things copyThing -d {"opts":{"commit":"no"}}'), /Invalid value 'no' for opts.commit/);
});

test('-d keeps typed JSON values and untyped strings as given', async () => {
    const [result] = await runAll('things copyThing -d {"opts":{"commit":false,"tags":["a,b"]}}');
    assert.deepEqual([result.commit, result.tags], [false, ['a,b']]);
    assert.deepEqual(await runAll('things untyped -d {"value":"0123"}'), ['0123']);
});

test('-d with a JSON array runs the command once per element', async () => {
    const results = await runAll(`things copyThing --data ${pathLib.relative(process.cwd(), BATCH)}`);
    assert.deepEqual(results.map(r => [r.id, r.commit]), [['a', true], ['b', false]]);
});

test('positionals fill the params left after imported and internal args', async () => {
    assert.equal((await run('things copyThing positional -d {"opts":{"limit":1}}')).id, 'positional');
    assert.equal((await run('things copyThing positional -d {"id":"imported"}')).id, 'imported');
});

test('-d requires a JSON object or array of objects', async () => {
    await assert.rejects(run('things copyThing -d'), /Option --data requires/);
    await assert.rejects(run('things copyThing -d 5'), /Option --data must be a JSON object/);
    await assert.rejects(run('things copyThing -d [1]'), /Option --data must be a JSON object/);
});

test('-j returns the results as JSON', async () => {
    assert.deepEqual(await runAll('things withOptions -j 1'), ['[{"amount":1}]']);
});

test('in sequence, a failing batch item gives its error as result without stopping the others', async () => {
    const results = await runAll('things failNegative -d [{"value":-1},{"value":2}]', { parallelize: false });
    assert.deepEqual(results, ['Error: Negative value', 2]);
});

test('in parallel, a failing batch item rejects the whole run', async () => {
    await assert.rejects(runAll('things failNegative -d [{"value":-1},{"value":2}]'), /Negative value/);
});

test('a flat list of source paths needs no group', async () => {
    const argv = ['node', 'cli.js', 'withOptions', '2'];
    assert.deepEqual(await autoCLI(argv, FIXTURE), [{ amount: 2, label: undefined }]);
    assert.deepEqual(await autoCLI(argv, [FIXTURE]), [{ amount: 2, label: undefined }]);
});

test('help lists all commands, and suggests the closest one for a typo', async (t) => {
    const { log } = await output(t, ['things', 'withOption']);
    assert.match(log, /Did you mean 'things withOptions'\?/);
    assert.match(log, /Usage: \S+ GROUP COMMAND/);
    assert.match(log, /GROUP: things/);
    const list = log.substring(log.indexOf('GROUP: things'));
    assert.ok(list.indexOf('copyThing') < list.indexOf('withOptions'), 'commands are sorted');
});

test('help for a flat list has no groups', async (t) => {
    const { log } = await output(t, [], FIXTURE);
    assert.match(log, /Usage: \S+ COMMAND/);
    assert.doesNotMatch(log, /GROUP/);
});

test('help for a command shows its arguments, hiding internal and options params', async (t) => {
    const { log } = await output(t, ['things', 'copyThing', '-h']);
    assert.match(log, /copyThing <id> --commit=true --limit=number --tags=string\[\] --format="json" --query=object/);
    assert.doesNotMatch(log, /internal|opts/);
});

test('-v prints the version, from options or the calling package', async (t) => {
    assert.equal((await output(t, ['-v'], FIXTURE, { cliVersion: '9.9.9' })).log, '9.9.9');
    t.mock.restoreAll();
    assert.match((await output(t, ['--version'], FIXTURE)).log, /^(\d+\.\d+\.\d+|Unversioned)$/);
});
