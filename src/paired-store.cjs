"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const protectedDirectories = new Set();
function privateDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('State directory must not be a symlink');
  fs.chmodSync(dir, 0o700);
  if (process.platform === 'win32' && !protectedDirectories.has(path.resolve(dir))) {
    // Restrict only this application's directory, never a parent/global ACL.
    const { spawnSync } = require('node:child_process');
    const sid = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const match = sid.stdout?.match(/S-1-\d+(?:-\d+)+/);
    if (sid.status !== 0 || !match) throw new Error('Cannot determine state owner SID');
    const result = spawnSync('icacls.exe', [path.resolve(dir), '/inheritance:r', '/grant:r', '*' + match[0] + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error('Cannot protect application state permissions');
    protectedDirectories.add(path.resolve(dir));
  }
}
function save(file, data) {
  privateDirectory(path.dirname(file));
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('State file must not be a symlink');
  const temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function load(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('State file must not be a symlink');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function validateInfo(info) {
  if (!info || info.version !== 1 || !['linux', 'win10'].includes(info.target) ||
      info.broker !== 'wss://broker.emqx.io:8084/mqtt' || info.user !== 'relay' ||
      !/^[a-f0-9]{32}$/.test(info.session) || !/^[a-f0-9]{64}$/.test(info.secret)) throw new Error('Invalid paired host');
  const parts = (info.hostPublicKey || '').split(' ');
  if (parts.length !== 2 || parts[0] !== 'ssh-ed25519') throw new Error('Invalid host key');
  const fp = 'SHA256:' + crypto.createHash('sha256').update(Buffer.from(parts[1], 'base64')).digest('base64').replace(/=+$/, '');
  if (fp !== info.fingerprint) throw new Error('Host fingerprint mismatch');
  if (typeof info.clientPrivateKey !== 'string' || !info.clientPrivateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')) throw new Error('Invalid client key');
  return info;
}
module.exports = { privateDirectory, save, load, validateInfo };
