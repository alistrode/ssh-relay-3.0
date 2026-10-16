"use strict";
// 128-bit one-time bearer code. A short numeric code would require a PAKE;
// deliberately do not reduce this entropy or publish an offline verifier.
const crypto = require('node:crypto');
const mqtt = require('mqtt');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { EventEmitter } = require('node:events');
const BROKER = 'wss://broker.emqx.io:8084/mqtt';
const TTL = 10 * 60 * 1000;
function normalize(code) {
  if (typeof code !== 'string') throw new Error('Pairing code required');
  const normalized = code.replace(/[-\s]/g, '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized)) throw new Error('Enter the complete 32-character pairing code');
  return normalized;
}
function keys(code) {
  const seed = Buffer.from(normalize(code), 'hex');
  return {
    key: Buffer.from(crypto.hkdfSync('sha256', seed, Buffer.from('ssh-relay-pair-v1'), Buffer.from('encryption'), 32)),
    topic: 'ssh-relay-pair/v1/' + crypto.createHmac('sha256', seed).update('rendezvous').digest('hex'),
  };
}
function seal(key, object) {
  const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('ssh-relay-pair-v1'));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(object)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), bytes]);
}
function open(key, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 29 || bytes.length > 16384) throw new Error('Invalid pairing frame');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from('ssh-relay-pair-v1')); cipher.setAuthTag(bytes.subarray(12, 28));
  const value = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
  if (!Number.isSafeInteger(value.time) || Math.abs(Date.now() - value.time) > 60000) throw new Error('Expired pairing frame');
  return value;
}
function channel(code, side) {
  const { key, topic } = keys(code), events = new EventEmitter();
  const proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
  const client = mqtt.connect(BROKER, { clientId: 'pair-' + crypto.randomBytes(12).toString('hex'), clean: true,
    reconnectPeriod: 5000, connectTimeout: 15000, keepalive: 30, queueQoSZero: false,
    wsOptions: proxy ? { agent: new HttpsProxyAgent(proxy) } : {} });
  let ready = false, closed = false;
  client.on('connect', () => client.subscribe(topic + '/' + side, { qos: 1 }, (error, grants) => {
    if (error || grants?.some(g => g.qos === 128)) { events.emit('issue', 'pair_subscribe_failed'); client.stream?.destroy(); return; }
    ready = true; events.emit('ready');
  }));
  client.on('close', () => { ready = false; });
  client.on('error', () => events.emit('issue', 'pair_broker_error'));
  client.on('message', (received, bytes) => {
    if (received !== topic + '/' + side) return;
    try { events.emit('frame', open(key, bytes)); } catch { /* Untrusted public broker input. */ }
  });
  events.send = frame => {
    if (!ready || closed) return;
    client.publish(topic + '/' + (side === 'far' ? 'near' : 'far'), seal(key, { ...frame, time: Date.now() }),
      { qos: 1, retain: false }, error => { if (error) events.emit('issue', 'pair_publish_failed'); });
  };
  events.close = () => { closed = true; clearTimeout(timer); client.end(true); };
  const timer = setTimeout(() => { events.emit('expired'); events.close(); }, TTL);
  return events;
}
function offer(info) {
  const code = crypto.randomBytes(16).toString('hex').match(/.{4}/g).join('-').toUpperCase();
  const wire = channel(code, 'far'); let accepted;
  wire.code = code; wire.expiresAt = Date.now() + TTL;
  wire.on('frame', frame => {
    if (!/^[a-f0-9]{32}$/.test(frame.requestId || '')) return;
    if (frame.type === 'request' && (!accepted || accepted === frame.requestId)) {
      accepted = frame.requestId;
      wire.send({ type: 'offer', requestId: accepted, info });
    } else if (frame.type === 'confirmed' && frame.requestId === accepted) {
      wire.send({ type: 'done', requestId: accepted });
      wire.emit('paired');
      // Keep briefly answering duplicate confirmation packets after lost PUBACKs.
      setTimeout(() => wire.close(), 15000).unref();
    }
  });
  return wire;
}
function redeem(code) {
  const wire = channel(code, 'near'), requestId = crypto.randomBytes(16).toString('hex');
  let received = false;
  const send = () => wire.send({ type: received ? 'confirmed' : 'request', requestId });
  wire.on('ready', send);
  wire.on('frame', frame => {
    if (frame.requestId !== requestId) return;
    if (frame.type === 'offer' && !received) {
      // Consumer must persist and validate BEFORE acknowledging the offer.
      wire.emit('offer', frame.info, () => { received = true; send(); });
    } else if (frame.type === 'done' && received) { wire.emit('complete'); wire.close(); }
  });
  const retry = setInterval(send, 2500);
  const close = wire.close; wire.close = () => { clearInterval(retry); close(); };
  return wire;
}
module.exports = { offer, redeem, normalize, keys, seal, open, TTL };
