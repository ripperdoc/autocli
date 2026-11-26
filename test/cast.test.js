const { test } = require('node:test');
const assert = require('node:assert/strict');
const { castValue, parseType, isStringType } = require('../lib/cast');

test('parseType splits unions at the top level only', () => {
    assert.deepEqual(parseType('?string|Array<string|number>='), ['string', 'Array<string|number>']);
    assert.deepEqual(parseType('(a: string) => void'), ['(a: string) => void']);
    assert.deepEqual(parseType(''), []);
});

test('booleans are cast from true/false strings', () => {
    assert.equal(castValue('true', 'boolean'), true);
    assert.equal(castValue('FALSE', 'boolean'), false);
    assert.equal(castValue(true, 'boolean'), true);
    assert.throws(() => castValue('yes', 'boolean', 'commit'), /Invalid value 'yes' for commit/);
});

test('numbers are cast, and invalid numbers rejected', () => {
    assert.equal(castValue('42', 'number'), 42);
    assert.equal(castValue('-1.5', 'number'), -1.5);
    assert.throws(() => castValue('abc', 'number'), /Invalid value/);
});

test('strings stay strings, even when they look like numbers or booleans', () => {
    assert.equal(castValue('0123', 'string'), '0123');
    assert.equal(castValue('true', 'string'), 'true');
});

test('unions prefer boolean, then number, then string', () => {
    assert.equal(castValue('true', 'boolean|string'), true);
    assert.equal(castValue('maybe', 'boolean|string'), 'maybe');
    assert.equal(castValue('5', 'string|number|Date'), 5);
    assert.equal(castValue('a,b', 'string|Array<string>'), 'a,b');
});

test('arrays are split on commas or parsed as JSON', () => {
    assert.deepEqual(castValue('a, b,c', 'string[]'), ['a', 'b', 'c']);
    assert.deepEqual(castValue('1,2', 'Array<number>'), [1, 2]);
    assert.deepEqual(castValue('["a b", "c"]', 'Array.<string>'), ['a b', 'c']);
});

test('string literal unions are validated', () => {
    assert.equal(castValue('csv', '"json"|"csv"'), 'csv');
    assert.throws(() => castValue('xml', '"json"|"csv"', 'format'), /expected one of json, csv/);
});

test('objects are parsed from JSON, other strings passed on', () => {
    assert.deepEqual(castValue('{"a": 1}', 'object'), { a: 1 });
    assert.equal(castValue('orderBy=key', 'object'), 'orderBy=key');
    assert.throws(() => castValue('{bad', 'object', 'query'), /Invalid JSON for query/);
});

test('untyped and unknown types keep the legacy number casting', () => {
    assert.equal(castValue('12', '*'), 12);
    assert.equal(castValue('12', undefined), 12);
    assert.equal(castValue('abc', '*'), 'abc');
    assert.equal(castValue('x', "import('x').Foo"), 'x');
});

test('isStringType tells which options to keep as strings', () => {
    assert.equal(isStringType('string'), true);
    assert.equal(isStringType('string|Array<string>'), true);
    assert.equal(isStringType('"a"|"b"'), true);
    assert.equal(isStringType('boolean|string'), false);
    assert.equal(isStringType('number'), false);
    assert.equal(isStringType('*'), false);
});
