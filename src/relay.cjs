"use strict";
var mqtt = require("mqtt");
var { HttpsProxyAgent } = require("https-proxy-agent");
var crypto = require("node:crypto");
var net = require("node:net");
var { EventEmitter } = require("node:events");
function createRelay(config, role) {
  if (!/^[a-f0-9]{32}$/.test(config.session) || !/^[a-f0-9]{64}$/.test(config.secret)) {
    throw new Error("Invalid session configuration");
  }
  const events = new EventEmitter();
  const opposite = role === "near" ? "far" : "near";
  const prefix = `ssh-public-relay/v1/${config.session}/`;
  const proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
  const client = mqtt.connect(config.broker, {
    clientId: `ssh-${role}-${crypto.randomBytes(10).toString("hex")}`,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 3e3,
    connectTimeout: 15e3,
    queueQoSZero: false,
    wsOptions: proxy ? { agent: new HttpsProxyAgent(proxy) } : {}
  });
  let ready = false;
  const connections = /* @__PURE__ */ new Map();
  function sign(body) {
    return crypto.createHmac("sha256", Buffer.from(config.secret, "hex")).update(body).digest();
  }
  function publish(frame) {
    if (!ready) return Promise.reject(new Error("Public relay is offline"));
    const body = JSON.stringify({ ...frame, time: Date.now(), role });
    const packet = JSON.stringify({ body, mac: sign(body).toString("base64") });
    return new Promise((resolve, reject) => client.publish(
      prefix + opposite,
      packet,
      { qos: 1, retain: false },
      (error) => error ? reject(error) : resolve()
    ));
  }
  function send(state, type, data2) {
    const frame = { cid: state.cid, seq: state.out++, type };
    if (data2) frame.data = data2.toString("base64");
    state.queue = state.queue.then(() => publish(frame));
    state.queue.catch(() => state.socket.destroy());
    return state.queue;
  }
  function attach(cid, socket, incoming = 0) {
    const state = { cid, socket, incoming, out: 0, queue: Promise.resolve(), opened: false };
    connections.set(cid, state);
    socket.on("data", (chunk) => {
      socket.pause();
      for (let i = 0; i < chunk.length; i += 16384) send(state, "data", chunk.subarray(i, i + 16384));
      state.queue.then(() => {
        if (!socket.destroyed) socket.resume();
      }).catch(() => {
      });
    });
    socket.on("end", () => send(state, "end").catch(() => {}));
    // close owns peer cleanup, including the close following a socket error.
    socket.on("error", () => {});
    socket.on("close", () => {
      connections.delete(cid);
      if (!state.peerAborted && (!socket.readableEnded || !socket.writableFinished)) {
        send(state, "abort").catch(() => {});
      }
    });
    socket.setTimeout(12e4, () => socket.destroy());
    return state;
  }
  client.on("connect", () => client.subscribe(prefix + role, { qos: 1 }, (error) => {
    if (error) return events.emit("diagnostic", error.message);
    ready = true;
    events.emit("ready");
  }));
  client.on("error", (error) => events.emit("diagnostic", error.message));
  client.on("offline", () => {
    ready = false;
    for (const state of connections.values()) state.socket.destroy();
    connections.clear();
    events.emit("offline");
  });
  client.on("message", (topic, raw) => {
    if (topic !== prefix + role || raw.length > 4e4) return;
    try {
      const envelope = JSON.parse(raw.toString());
      if (typeof envelope.body !== "string" || typeof envelope.mac !== "string") return;
      const mac = Buffer.from(envelope.mac, "base64");
      if (mac.length !== 32 || !crypto.timingSafeEqual(mac, sign(envelope.body))) return;
      const frame = JSON.parse(envelope.body);
      if (frame.role !== opposite || !Number.isSafeInteger(frame.time) || Math.abs(Date.now() - frame.time) > 12e4) return;
      if (frame.type === "status") return events.emit("peer", frame.status);
      if (!/^[a-f0-9]{32}$/.test(frame.cid) || !Number.isSafeInteger(frame.seq) || frame.seq < 0) return;
      let state = connections.get(frame.cid);
      if (role === "far" && frame.type === "open" && frame.seq === 0) {
        if (state || connections.size >= 8) return;
        const socket = net.connect({ host: "127.0.0.1", port: config.sshPort, allowHalfOpen: true });
        state = attach(frame.cid, socket, 1);
        socket.pause();
        socket.on("connect", () => {
          state.opened = true;
          send(state, "opened").then(() => socket.resume()).catch(() => {
          });
        });
        return;
      }
      if (!state || frame.seq < state.incoming) return;
      if (frame.seq !== state.incoming) return state.socket.destroy(new Error("Relay sequence gap"));
      state.incoming++;
      if (frame.type === "opened" && role === "near") {
        state.opened = true;
        state.socket.resume();
      } else if (frame.type === "data" && typeof frame.data === "string" && state.opened) {
        if (state.socket.writableLength > 2097152) return state.socket.destroy();
        state.socket.write(Buffer.from(frame.data, "base64"));
      } else if (frame.type === "end") state.socket.end();
      else if (frame.type === "abort") {
        state.peerAborted = true;
        state.socket.destroy();
      }
    } catch {
    }
  });
  events.open = (socket) => {
    if (!ready) return socket.destroy();
    const cid = crypto.randomBytes(16).toString("hex");
    socket.pause();
    const state = attach(cid, socket);
    send(state, "open").catch(() => {
    });
    const timer = setTimeout(() => {
      if (!state.opened) socket.destroy();
    }, 2e4);
    timer.unref();
    socket.once("close", () => clearTimeout(timer));
  };
  events.status = (status) => publish({ type: "status", status });
  events.close = () => {
    ready = false;
    for (const state of connections.values()) state.socket.destroy();
    client.end(true);
  };
  return events;
}
module.exports = { createRelay };
