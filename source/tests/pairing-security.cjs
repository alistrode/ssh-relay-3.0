const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { keys, seal, open, normalize } = require('../src/pairing.cjs');
const { save, load, privateDirectory } = require('../src/paired-store.cjs');
const code = crypto.randomBytes(16).toString('hex');
assert.equal(normalize(code.toUpperCase().match(/.{4}/g).join('-')), code);
assert.throws(() => normalize('123456'));
const a = keys(code), b = keys(crypto.randomBytes(16).toString('hex'));
const value = { type: 'offer', time: Date.now(), info: { test: '中文' } };
const bytes = seal(a.key, value);
assert.deepEqual(open(a.key, bytes), value);
assert.throws(() => open(b.key, bytes));
const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
assert.throws(() => open(a.key, corrupt));
assert.throws(() => open(a.key, seal(a.key, { time: Date.now() - 120000 })));
assert.throws(() => open(a.key, Buffer.alloc(17000)));
assert.notDeepEqual(seal(a.key, value), bytes);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-store-test-'));
try {
  privateDirectory(root); const file = path.join(root, 'state.json'); save(file, value);
  assert.deepEqual(load(file), value);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  save(file, { replacement: true }); assert.deepEqual(load(file), { replacement: true });
  if (process.platform !== 'win32') { const link = path.join(root, 'link.json'); fs.symlinkSync(file, link); assert.throws(() => save(link, value)); }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('Pairing: authenticated encryption, wrong-code/tamper/expiry rejection, high-entropy format and private atomic persistence passed.');
