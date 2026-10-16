"use strict";
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { fork } = require('node:child_process');
const { Client } = require('ssh2');
const net = require('node:net');
const crypto = require('node:crypto');
const { createRelay } = require('./relay.cjs');
const { createTraceWriter } = require('./diagnostics.cjs');
const { save, load, validateInfo, privateDirectory } = require('./paired-store.cjs');
const pairing = require('./pairing.cjs');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = path.resolve(option('--state-dir') || path.join(os.homedir(), '.ssh-relay-paired'));
const role = option('--role');
if (!['near', 'far'].includes(role)) throw new Error('--role near|far required');
privateDirectory(root);
// A deterministic loopback bind is an atomic, crash-safe per-state lock.
// A collision fails closed and never terminates another process.
const lockFile = path.join(root, 'agent-lock.json');
const lock = net.createServer(socket => socket.end('ssh-relay-paired\n'));
let settings = load(path.join(root, 'settings.json'), { autoConnect: true, selected: null, targets: {} });
let view = { role, phase: 'starting', connected: false, attempt: 0, nextRetryAt: null, lastError: null };
const log = createTraceWriter(root, role + '-manager');
let stopping = false, relay, listener, ssh, worker, pair, timer, healthTimer, retryTimer;
let workerStableTimer;
let generation = 0, failures = 0, workerFailures = 0, nextConnecting = false, identityBlocked = false;
const sockets = new Set();
const logEvent = (event, details = {}) => log({ event, ...details });
function publish(change = {}) {
  if (typeof change.connected === 'boolean' && role === 'near') {
    const reportPath = path.join(root, 'connection-private.json');
    const report = load(reportPath, null);
    if (report && report.connected !== change.connected) save(reportPath, { ...report, connected: change.connected });
  }
  view = { ...view, ...change, updatedAt: new Date().toISOString(), targets: Object.entries(settings.targets).map(([id, t]) => ({ id, hostname: t.hostname, fingerprint: t.fingerprint })), selected: settings.selected, autoConnect: settings.autoConnect };
  save(path.join(root, 'status.json'), view);
  process.send?.({ type: 'status', status: view });
}
function persist() { save(path.join(root, 'settings.json'), settings); }
function delay(attempt) { return Math.round(Math.min(60000, 2000 * 2 ** Math.min(Math.max(0, attempt - 3), 5)) * (0.8 + Math.random() * 0.2)); }
function pairingStatus() { return pair && role === 'far' && pair.expiresAt > Date.now() ? { code: pair.code, expiresAt: pair.expiresAt } : null; }
function startPair() {
  if (role !== 'far') throw new Error('Only the remote generates pairing codes');
  const info = load(path.join(root, 'far', 'connection-private.json'));
  if (!info) throw new Error('Remote identity is still starting');
  const links = load(path.join(root, 'paired-links-private.json'), []);
  if (links.length >= 16) throw new Error('Maximum 16 paired endpoints; revoke unused access first');
  const offered = { ...info, session: crypto.randomBytes(16).toString('hex'), secret: crypto.randomBytes(32).toString('hex'), hostname: os.hostname() };
  pair?.close();
  pair = pairing.offer(offered);
  const activePair = pair;
  // Intentionally private, never part of a diagnostic export or status.json.
  save(path.join(root, 'pairing-private.json'), pairingStatus());
  pair.on('paired', () => {
    if (pair !== activePair) return;
    const current = load(path.join(root, 'paired-links-private.json'), []);
    if (!current.some(link => link.session === offered.session)) {
      current.push({ session: offered.session, secret: offered.secret, pairedAt: Date.now() });
      save(path.join(root, 'paired-links-private.json'), current);
      worker?.send({ type: 'add-link', session: offered.session, secret: offered.secret });
    }
    pair.expiresAt = 0; fs.rmSync(path.join(root, 'pairing-private.json'), { force: true }); logEvent('pairing_completed'); process.send?.({ type: 'pairing', pairing: null });
  });
  pair.on('issue', code => logEvent(code));
  pair.on('expired', () => { fs.rmSync(path.join(root, 'pairing-private.json'), { force: true }); logEvent('pairing_expired'); process.send?.({ type: 'pairing', pairing: null }); });
  process.send?.({ type: 'pairing', pairing: pairingStatus() });
  logEvent('pairing_opened', { expiresAt: pair.expiresAt });
}
function redeem(code) {
  if (role !== 'near') throw new Error('Only the local endpoint accepts pairing codes');
  pair?.close(); pair = pairing.redeem(code);
  publish({ phase: 'pairing', lastError: null });
  pair.on('offer', (raw, confirm) => {
    try {
      const info = validateInfo(raw);
      if (typeof info.hostname !== 'string' || !info.hostname || info.hostname.length > 255) throw new Error('Invalid host identity');
      const existing = settings.targets[info.session];
      if (existing && existing.fingerprint !== info.fingerprint) throw new Error('Pinned host identity changed');
      const folder = path.join(root, 'targets', info.session);
      save(path.join(folder, 'info-private.json'), info);
      settings.targets[info.session] = { hostname: info.hostname, fingerprint: info.fingerprint };
      settings.selected = info.session; settings.autoConnect = true; persist();
      confirm(); logEvent('pairing_saved');
      startNear().catch(fatal);
    } catch { logEvent('pairing_rejected'); publish({ phase: 'pairing_error', lastError: 'pairing_validation_failed' }); }
  });
  pair.on('expired', () => { if (!settings.selected) publish({ phase: 'pairing_expired' }); });
  pair.on('issue', code => logEvent(code));
}
function stopNear() {
  generation++; clearTimeout(retryTimer); retryTimer = null; clearTimeout(healthTimer); nextConnecting = false;
  if (ssh) { ssh.removeAllListeners('close'); ssh.destroy(); ssh = null; }
  relay?.close(); relay = null;
  for (const socket of sockets) socket.destroy(); sockets.clear();
  listener?.close(); listener = null;
}
function classify(error) {
  const message = String(error?.message || '');
  if (/host denied|fingerprint|host key|identity/i.test(message)) return 'identity_mismatch';
  if (/authentication methods failed|authentication failure/i.test(message)) return 'authorization_failed';
  return error?.level === 'client-timeout' ? 'ssh_timeout' : 'connection_lost';
}
async function startNear() {
  stopNear(); identityBlocked = false; failures = 0;
  if (!settings.autoConnect || !settings.selected) return publish({ phase: settings.selected ? 'paused' : 'unpaired', connected: false });
  const current = generation;
  const folder = path.join(root, 'targets', settings.selected);
  const info = validateInfo(load(path.join(folder, 'info-private.json')));
  relay = createRelay(info, 'near');
  relay.on('trace', log);
  relay.on('diagnostic', () => logEvent('relay_diagnostic'));
  listener = net.createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    relay?.open(socket);
  });
  listener.on('error', fatal);
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  if (current !== generation || stopping) return;
  const port = listener.address().port;
  const config = { ...info, localPort: port, statusPath: path.join(folder, 'peer.json') };
  save(path.join(folder, 'near.json'), config);
  save(path.join(folder, 'runtime.json'), { pid: process.pid, port });
  fs.writeFileSync(path.join(folder, 'client_key'), info.clientPrivateKey, { mode: 0o600 });
  const alias = 'relay-' + info.session;
  fs.writeFileSync(path.join(folder, 'known_hosts'), alias + ' ' + info.hostPublicKey + '\n', { mode: 0o600 });
  publish({ phase: 'connecting', connected: false, localPort: port, nextRetryAt: null, lastError: null });
  relay.on('ready', () => { relay.status({ near: true }).catch(() => {}); });
  relay.on('offline', () => { if (current === generation) publish({ phase: 'relay_offline', connected: false }); });
  relay.on('peer', peer => {
    if (current !== generation || stopping) return;
    if (peer.fingerprint !== info.fingerprint) {
      identityBlocked = true; ssh?.destroy(); clearTimeout(retryTimer);
      publish({ phase: 'identity_error', connected: false, lastError: 'identity_mismatch' }); logEvent('identity_mismatch'); return;
    }
    if (peer.relayProtocol !== 2) { identityBlocked = true; publish({ phase: 'protocol_error', connected: false, lastError: 'protocol_2_required' }); return; }
    save(path.join(folder, 'peer.json'), { ...peer, receivedAt: Date.now() });
    if (!ssh && !nextConnecting && !retryTimer && !identityBlocked) connect();
  });
  function schedule(code) {
    if (current !== generation || stopping || identityBlocked || !settings.autoConnect) return;
    failures++; const wait = delay(failures);
    publish({ phase: 'retry_wait', connected: false, attempt: failures, nextRetryAt: Date.now() + wait, lastError: code });
    logEvent('ssh_retry_scheduled', { attempt: failures, delayMs: wait, code });
    clearTimeout(retryTimer); retryTimer = setTimeout(() => { retryTimer = null; connect(); }, wait);
  }
  function connect() {
    if (current !== generation || stopping || identityBlocked || nextConnecting || ssh) return;
    nextConnecting = true;
    const client = new Client(); ssh = client;
    let verified = false, finished = false, lastCode = 'connection_lost', verifiedAt = 0;
    publish({ phase: 'connecting', nextRetryAt: null }); logEvent('ssh_connecting', { attempt: failures + 1 });
    function failed(code) {
      if (finished) return; finished = true; nextConnecting = false;
      clearTimeout(healthTimer);
      if (ssh === client) ssh = null;
      if (['identity_mismatch', 'authorization_failed'].includes(code)) {
        identityBlocked = true; publish({ phase: 'identity_error', connected: false, lastError: code }); logEvent(code);
      } else schedule(code);
      client.destroy();
    }
    client.on('error', error => { lastCode = classify(error); failed(lastCode); });
    client.on('close', () => failed(lastCode));
    client.on('ready', () => probe());
    function probe() {
      if (finished || current !== generation) return;
      const command = info.target === 'win10' ? 'whoami & hostname' : 'whoami; hostname';
      let output = '', timeout = setTimeout(() => failed('identity_probe_timeout'), 30000);
      client.exec(command, (error, stream) => {
        if (error) { clearTimeout(timeout); return failed('identity_probe_failed'); }
        stream.on('data', b => { output += b.toString(); if (output.length > 4096) { clearTimeout(timeout); failed('identity_probe_overflow'); } });
        stream.stderr.resume();
        stream.on('close', code => {
          clearTimeout(timeout); if (finished || current !== generation) return;
          const lines = output.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          if (code !== 0 || lines.length !== 2 || lines[1].toLowerCase() !== info.hostname.toLowerCase()) return failed('identity_mismatch');
          if (!args.includes('--allow-cloud-self-test') && lines[1].toLowerCase() === os.hostname().toLowerCase()) return failed('identity_mismatch');
          const identity = load(path.join(folder, 'identity.json'), null);
          if (identity && (identity.user !== lines[0] || identity.hostname.toLowerCase() !== lines[1].toLowerCase())) return failed('identity_mismatch');
          if (!identity) save(path.join(folder, 'identity.json'), { user: lines[0], hostname: lines[1] });
          if (!verified) {
            verified = true; verifiedAt = Date.now(); nextConnecting = false;
            logEvent('ssh_identity_verified');
            const argv = ['ssh', '-F', os.devNull, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + path.join(folder, 'known_hosts'), '-o', 'HostKeyAlias=' + alias, '-o', 'ConnectTimeout=20', '-i', path.join(folder, 'client_key'), '-p', String(port), 'relay@127.0.0.1'];
            save(path.join(root, 'connection-private.json'), { connected: true, target: info.target, remote_user: lines[0], remote_hostname: lines[1], host_fingerprint: info.fingerprint, cloud_self_test: lines[1].toLowerCase() === os.hostname().toLowerCase(), state_directory: folder, ssh_argv: argv });
          }
          if (Date.now() - verifiedAt >= 60000) failures = 0;
          publish({ phase: 'connected', connected: true, remoteUser: lines[0], remoteHostname: lines[1], fingerprint: info.fingerprint, protocol: 2, attempt: 0, nextRetryAt: null, lastError: null, lastVerifiedAt: Date.now() });
          healthTimer = setTimeout(probe, 15000);
        });
      });
    }
    client.connect({ host: '127.0.0.1', port, username: info.user, privateKey: info.clientPrivateKey,
      readyTimeout: 45000, keepaliveInterval: 10000, keepaliveCountMax: 3,
      hostVerifier: key => {
        const fp = 'SHA256:' + require('node:crypto').createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
        return fp === info.fingerprint;
      } });
  }
}
function startFar() {
  if (stopping) return;
  publish({ phase: 'starting', connected: false, activeSshClients: 0 });
  worker = fork(path.join(__dirname, 'start.cjs'), [], { env: { ...process.env, RELAY_STATE_DIR: path.join(root, 'far'), RELAY_NO_PRINT: '1' }, silent: true, windowsHide: true });
  publish({ workerPid: worker.pid });
  // Child writes only private trace metadata to its own rotating sink.
  worker.stdout.resume(); worker.stderr.resume();
  worker.on('message', message => {
    if (stopping) return;
    if (message.type === 'ready') {
      if (!workerStableTimer) {
        workerStableTimer = setTimeout(() => { workerFailures = 0; workerStableTimer = null; }, 60000);
        workerStableTimer.unref();
      }
      for (const link of load(path.join(root, 'paired-links-private.json'), [])) worker?.send({ type: 'add-link', session: link.session, secret: link.secret });
      publish({ phase: view.activeSshClients ? 'connected' : 'listening', connected: !!view.activeSshClients, fingerprint: message.fingerprint, protocol: message.protocol, nextRetryAt: null, lastError: null });
    }
    if (message.type === 'link-error') publish({ lastError: 'paired_link_error' });
    if (message.type === 'ssh-clients' && Number.isInteger(message.count) && message.count >= 0) publish({ activeSshClients: message.count, connected: message.count > 0, phase: message.count > 0 ? 'connected' : 'listening' });
    if (message.type === 'offline') { clearTimeout(workerStableTimer); workerStableTimer = null; if (!view.activeSshClients) publish({ phase: 'relay_offline', connected: false }); }
  });
  worker.on('error', () => logEvent('worker_start_error'));
  worker.on('exit', (code, signal) => {
    clearTimeout(workerStableTimer); workerStableTimer = null;
    worker = null; if (stopping) return;
    const wait = delay(++workerFailures);
    logEvent('worker_exit', { code, signal, delayMs: wait });
    publish({ phase: 'retry_wait', connected: false, activeSshClients: 0, nextRetryAt: Date.now() + wait, lastError: 'remote_process_exited' });
    timer = setTimeout(startFar, wait);
  });
}
async function control(message) {
  if (!message || typeof message !== 'object') return;
  switch (message.action) {
    case 'pair': if (role === 'far') startPair(); else redeem(message.code); break;
    case 'snapshot': publish(); if (role === 'far') process.send?.({ type: 'pairing', pairing: pairingStatus() }); break;
    case 'connect': settings.autoConnect = true; if (message.target) { if (!settings.targets[message.target]) throw new Error('Unknown target'); settings.selected = message.target; } persist(); if (role === 'near') await startNear(); break;
    case 'pause': settings.autoConnect = false; persist(); if (role === 'near') stopNear(); publish({ phase: 'paused', connected: false }); break;
    case 'forget': if (role !== 'near' || !settings.targets[message.target]) throw new Error('Unknown target'); if (settings.selected === message.target) { stopNear(); settings.selected = null; } delete settings.targets[message.target]; fs.rmSync(path.join(root, 'targets', message.target), { recursive: true, force: true }); persist(); publish({ phase: 'unpaired', connected: false }); break;
    case 'revoke-all': {
      if (role !== 'far' || !worker) throw new Error('Remote is not running');
      pair?.close(); pair = null; fs.rmSync(path.join(root, 'pairing-private.json'), { force: true });
      process.send?.({ type: 'pairing', pairing: null });
      const old = worker;
      old.once('exit', () => {
        fs.rmSync(path.join(root, 'far'), { recursive: true, force: true });
        fs.rmSync(path.join(root, 'paired-links-private.json'), { force: true });
        logEvent('all_pairings_revoked');
      });
      if (old.connected) old.send({ type: 'shutdown' }); else old.kill();
      setTimeout(() => { if (old.exitCode === null && old.signalCode === null) old.kill(); }, 2500).unref();
      break;
    }
    case 'quit': shutdown(); break;
    default: throw new Error('Unknown action');
  }
}
function fatal() { logEvent('manager_error'); publish({ phase: 'error', connected: false, lastError: 'manager_error' }); }
function shutdown() {
  if (stopping) return; stopping = true;
  clearTimeout(timer); pair?.close(); stopNear();
  clearTimeout(workerStableTimer);
  if (worker?.connected) worker.send({ type: 'shutdown' });
  const activeWorker = worker;
  setTimeout(() => { if (activeWorker?.exitCode === null && activeWorker?.signalCode === null) activeWorker.kill(); }, 2000).unref();
  publish({ phase: 'stopped', connected: false }); lock.close();
  setTimeout(() => process.exit(0), 2200).unref();
}
process.on('message', message => Promise.resolve(control(message)).catch(fatal));
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
// A GUI losing IPC must not leave an unmanaged background agent behind.
if (process.send) process.on('disconnect', shutdown);
async function main() {
  const canonical = fs.realpathSync(root);
  const lockIdentity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const lockPort = 30000 + crypto.createHash('sha256').update(lockIdentity).digest().readUInt32BE(0) % 20000;
  await new Promise((resolve, reject) => {
    lock.once('error', () => reject(new Error('Instance lock port is occupied; no process was terminated')));
    lock.listen(lockPort, '127.0.0.1', resolve);
  });
  save(lockFile, { pid: process.pid, port: lock.address().port });
  logEvent('manager_started', { pid: process.pid });
  if (role === 'far') startFar(); else await startNear();
  // File-based control is for automated acceptance only. Never log its contents.
  const controlFile = option('--control-file');
  if (controlFile) {
    const poll = setInterval(() => {
      if (stopping) return clearInterval(poll);
      if (!fs.existsSync(controlFile)) return;
      try { const message = load(controlFile); fs.unlinkSync(controlFile); Promise.resolve(control(message)).catch(fatal); } catch { logEvent('control_file_error'); }
    }, 500);
  }
}
main().catch(error => { console.error(error.message); process.exit(1); });
