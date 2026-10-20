/**
 * tests/args.test.js — Parser de argumentos.
 */
const test = require('node:test');
const assert = require('node:assert');

const { parse, listFlag } = require('../lib/args.js');

test('posicionales y flags simples', () => {
  const { positional, flags } = parse(['issue', 'Cliente', 'sucursal', 'KEY', '3']);
  assert.deepStrictEqual(positional, ['issue', 'Cliente', 'sucursal', 'KEY', '3']);
  assert.deepStrictEqual(flags, {});
});

test('--flag valor y --flag=valor', () => {
  assert.strictEqual(parse(['x', '--days', '30']).flags.days, '30');
  assert.strictEqual(parse(['x', '--days=30']).flags.days, '30');
});

test('flags booleanas y --no-', () => {
  assert.strictEqual(parse(['x', '--full']).flags.full, true);
  assert.strictEqual(parse(['x', '--no-full']).flags.full, false);
  assert.strictEqual(parse(['x', '--full', '--no-full']).flags.full, false);
});

test('flags greedy: --features a b c', () => {
  const { positional, flags } = parse(['issue', 'Cliente', '--features', 'inventory', 'reports']);
  assert.deepStrictEqual(positional, ['issue', 'Cliente']);
  assert.deepStrictEqual(listFlag(flags, 'features'), ['inventory', 'reports']);
});

test('flags greedy: corta en el próximo --', () => {
  const { flags } = parse(['--features', 'a', 'b', '--days', '30']);
  assert.deepStrictEqual(listFlag(flags, 'features'), ['a', 'b']);
  assert.strictEqual(flags.days, '30');
});

test('listFlag acepta coma y espacios', () => {
  assert.deepStrictEqual(listFlag({ features: 'a,b, c' }, 'features'), ['a', 'b', 'c']);
});

test('flags repetidas se acumulan', () => {
  const { flags } = parse(['--features', 'a', '--features', 'b']);
  assert.deepStrictEqual(listFlag(flags, 'features'), ['a', 'b']);
});

test('-- termina los flags', () => {
  const { positional } = parse(['a', '--', '--no-es-flag']);
  assert.deepStrictEqual(positional, ['a', '--no-es-flag']);
});
