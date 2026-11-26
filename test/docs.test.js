const { test } = require('node:test');
const assert = require('node:assert/strict');
const pathLib = require('path');
const { makeCommands, parseDocs } = require('../lib/docs');

const FIXTURE = pathLib.join(__dirname, 'fixtures/commands.js');
const doc = (description, extra = '') => `/**\n * ${description}\n${extra} */\n`;

test('only documented exported functions become commands', () => {
    assert.deepEqual(Object.keys(makeCommands(FIXTURE)).sort(),
        ['copyThing', 'failNegative', 'modernTypes', 'untyped', 'withOptions']);
});

test('TypeScript-style type expressions are kept as written', () => {
    const { params } = makeCommands(FIXTURE).modernTypes;
    assert.deepEqual(params.map(p => p.type), ["import('./types').Thing", '{[key: string]: number}', 'boolean']);
});

test('a one-line block followed by code does not swallow the next block', () => {
    const docs = parseDocs(`/** One */ exports.x = () => 1;\n${doc('Two')}exports.y = () => 2;\n`);
    assert.equal(docs.x.description, 'One');
    assert.equal(docs.y.description, 'Two');
});

test('comments between the block and the declaration are skipped', () => {
    const docs = parseDocs(`${doc('Doc')}// eslint-disable-next-line\n/* other */\nexports.x = () => 1;\n`);
    assert.equal(docs.x.description, 'Doc');
});

test('JSDoc-like text in strings is not a block', () => {
    const docs = parseDocs(`const glob = '/**/x';\n${doc('Doc')}exports.x = () => glob;\n`);
    assert.deepEqual(Object.keys(docs), ['x']);
});

test('chained and wrapped exports get the docs under each exported name', () => {
    const docs = parseDocs(`${doc('A')}exports.a = exports.b = () => 1;\n${doc('C')}const c = (exports.d = () => 1);\n`);
    assert.deepEqual(Object.keys(docs).sort(), ['a', 'b', 'd', 'c'].sort());
});

test('type-only blocks do not document the following declaration', () => {
    const docs = parseDocs(`/**\n * @typedef {object} Foo\n */\nexports.x = () => 1;\n`);
    assert.deepEqual(docs, {});
});

test('invalid param tags are ignored rather than creating unnamed params', () => {
    const docs = parseDocs(`${doc('Doc', ' * @param {string} [opts.eq=a=b]\n * @param {string} ok - fine\n')}exports.x = () => 1;\n`);
    assert.deepEqual(docs.x.params.map(p => [p.name, p.description]), [['ok', 'fine']]);
});
