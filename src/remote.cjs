"use strict";
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");
var crypto = require("node:crypto");
var { spawn } = require("node:child_process");
var { Server, utils } = require("ssh2");
var { createRelay } = require("./relay.cjs");
var { createTraceWriter } = require("./diagnostics.cjs");
var { serveSftp } = require("./sftp.cjs");
var { attachForwarding } = require("./forwarding.cjs");
var { inspectPermissions, requireUsableContext } = require("./permissions.cjs");
var executionContext = inspectPermissions();
requireUsableContext(executionContext);
var root = path.resolve(process.argv[2] || path.join(__dirname, "config"));
var config = JSON.parse(
  fs.readFileSync(path.join(root, "remote.json"), "utf8"),
);
var allowed = utils.parseKey(
  fs.readFileSync(path.join(root, "client_key.pub")),
);
if (allowed instanceof Error) throw allowed;
var hostKey = fs.readFileSync(path.join(root, "host_key"));
var parsedHost = utils.parseKey(hostKey);
if (parsedHost instanceof Error) throw parsedHost;
var fingerprint =
  "SHA256:" +
  crypto
    .createHash("sha256")
    .update(parsedHost.getPublicSSH())
    .digest("base64")
    .replace(/=+$/, "");
var children = /* @__PURE__ */ new Set();
var clients = /* @__PURE__ */ new Set();
var authenticatedClients = new Set();
var recordTrace = createTraceWriter(root, "far");
var nextSshId = 0;
var traceSsh = (event, details = {}) => {
  const entry = {
    time: new Date().toISOString(),
    event: "ssh_" + event,
    ...details,
  };
  recordTrace(entry);
  console.error("SSH_TRACE " + JSON.stringify(entry));
};
var server = new Server({ hostKeys: [hostKey] }, (client, info) => {
  const sshId = ++nextSshId;
  traceSsh("accepted", { sshId, sourcePort: info.port });
  client.on("handshake", () => traceSsh("handshake", { sshId }));
  client.on("end", () => traceSsh("end", { sshId }));
  clients.add(client);
  client.on("error", (error) =>
    traceSsh("error", { sshId, code: error.code, message: error.message }),
  );
  client.on("close", () => {
    traceSsh("close", { sshId });
    clients.delete(client);
    authenticatedClients.delete(client);
    process.send?.({ type: 'ssh-clients', count: authenticatedClients.size });
  });
  client.on("authentication", (ctx) => {
    if (
      ctx.username !== config.user ||
      ctx.method !== "publickey" ||
      !ctx.key.data.equals(allowed.getPublicSSH()) ||
      (ctx.signature &&
        allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true)
    ) {
      return ctx.reject(["publickey"]);
    }
    traceSsh("authenticated", { sshId });
    ctx.accept();
  });
  client.on("ready", () => {
    authenticatedClients.add(client);
    process.send?.({ type: 'ssh-clients', count: authenticatedClients.size });
    console.log("SSH public-key authentication succeeded.");
    traceSsh("ready", { sshId });
    attachForwarding(client);
    client.on("session", (accept) => {
      const session = accept();
      function start(accept2, command) {
        const stream = accept2();
        const windows = process.platform === "win32";
        const shell = windows ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
        const args =
          command === void 0
            ? windows
              ? ["/Q"]
              : ["-s"]
            : windows
              ? ["/d", "/s", "/c", command]
              : ["-c", command];
        const child = spawn(shell, args, {
          cwd: os.homedir(),
          windowsHide: true,
          detached: !windows,
          stdio: "pipe",
        });
        children.add(child);
        traceSsh("process_start", {
          sshId,
          pid: child.pid,
          interactive: command === void 0,
        });
        child.terminate = (signal = "SIGTERM") => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          if (windows) {
            const killer = spawn(
              "taskkill.exe",
              ["/PID", String(child.pid), "/T", "/F"],
              { windowsHide: true, stdio: "ignore" },
            );
            killer.on("error", () => child.kill());
          } else {
            try {
              process.kill(-child.pid, signal);
            } catch {
              child.kill(signal);
            }
          }
        };
        session.on("signal", (acceptSignal, rejectSignal, info) => {
          const signal = info.name.startsWith("SIG")
            ? info.name
            : "SIG" + info.name;
          if (
            !["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP", "SIGQUIT"].includes(
              signal,
            )
          )
            return rejectSignal?.();
          child.terminate(signal);
          acceptSignal?.();
        });
        stream.pipe(child.stdin);
        child.stdin.on("error", () => {});
        child.stdout.pipe(stream, { end: false });
        child.stderr.pipe(stream.stderr, { end: false });
        let finished = false;
        child.on("error", (error) => {
          if (finished) return;
          finished = true;
          stream.stderr.write(error.message + "\n");
          stream.exit(1);
          stream.end();
        });
        child.on("close", (code) => {
          traceSsh("process_close", { sshId, pid: child.pid, code });
          children.delete(child);
          if (finished) return;
          finished = true;
          stream.exit(code === null ? 1 : code);
          stream.end();
        });
        stream.on("close", () => {
          traceSsh("channel_close", {
            sshId,
            pid: child.pid,
            processFinished: finished,
          });
          if (!finished) child.terminate();
        });
      }
      session.on("exec", (accept2, reject, info2) =>
        start(accept2, info2.command),
      );
      session.on("shell", (accept2) => start(accept2));
      session.on("sftp", (accept2) => serveSftp(accept2()));
    });
  });
});
server.on("error", (error) => {
  console.error("SSH server:", error.message);
  process.exit(1);
});
var relay;
var heartbeat;
var relays = new Map();
var status;
function addRelay(link, primary = false) {
  if (relays.has(link.session)) return;
  if (relays.size >= 17) throw new Error('Paired relay capacity reached');
  const endpoint = createRelay({ ...config, session: link.session, secret: link.secret }, 'far');
  relays.set(link.session, endpoint);
  endpoint.on('ready', () => {
    if (primary) process.send?.({ type: 'ready', fingerprint, protocol: 2 });
    endpoint.status(status).catch(() => {});
  });
  endpoint.on('peer', () => endpoint.status(status).catch(() => {}));
  endpoint.on('offline', () => { if (primary) process.send?.({ type: 'offline' }); });
  endpoint.on('diagnostic', message => console.error('Relay:', message));
  endpoint.on('trace', entry => { recordTrace(entry); console.error('RELAY_TRACE ' + JSON.stringify(entry)); });
  return endpoint;
}
server.listen(config.sshPort, "127.0.0.1", () => {
  config.sshPort = server.address().port;
  console.log(
    "SSH service ready on loopback. Host fingerprint: " + fingerprint,
  );
  status = {
    capabilities: {
      exec: true,
      sftp: true,
      shell: true,
      pty: false,
      forwarding: "loopback-only",
      reliableRelay: true,
      version: 3,
    },
    fingerprint,
    platform: process.platform,
    user: config.user,
    hostname: os.hostname(),
    permissions: executionContext,
  };
  relay = addRelay(config, true);
  heartbeat = setInterval(() => { for (const endpoint of relays.values()) endpoint.status(status).catch(() => {}); }, 15e3);
});
function close() {
  clearInterval(heartbeat);
  for (const endpoint of relays.values()) endpoint.close();
  for (const child of children) child.terminate();
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2e3).unref();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
process.on("message", message => {
  if (message?.type === "shutdown") close();
  if (message?.type === 'add-link' && status && /^[a-f0-9]{32}$/.test(message.session) && /^[a-f0-9]{64}$/.test(message.secret)) {
    try { addRelay(message); } catch { process.send?.({ type: 'link-error' }); }
  }
});
if (process.send) process.on("disconnect", close);
