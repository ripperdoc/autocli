const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgv } = require('../lib/argv');

const parse = (line, takesValue) => parseArgv(line.split(' '), takesValue);

test('values are kept as strings', () => {
    assert.deepEqual(parse('cmd 0123 --id=0042 --name x'), { positionals: ['cmd', '0123'], options: { id: '0042', name: 'x' } });
});

test('boolean flags do not take the next positional as value', () => {
    const isFlag = (key) => key !== 'dry';
    assert.deepEqual(parse('cmd --dry file.txt', isFlag), { positionals: ['cmd', 'file.txt'], options: { dry: true } });
});

test('boolean flags accept an explicit true or false', () => {
    assert.deepEqual(parse('--dry false x', () => false), { positionals: ['x'], options: { dry: 'false' } });
    assert.deepEqual(parse('--no-dry'), { positionals: [], options: { dry: false } });
});

test('negative numbers are values, not flags', () => {
    assert.deepEqual(parse('cmd -5 --x -1.5'), { positionals: ['cmd', '-5'], options: { x: '-1.5' } });
});

test('dotted options give nested objects and repeated options give arrays', () => {
    assert.deepEqual(parse('--query.equalTo=a=b --tag a --tag b').options, { query: { equalTo: 'a=b' }, tag: ['a', 'b'] });
});

test('-- ends options', () => {
    assert.deepEqual(parse('cmd -- --not-an-option'), { positionals: ['cmd', '--not-an-option'], options: {} });
});
