"use strict";
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");
var crypto = require("node:crypto");
var { spawn } = require("node:child_process");
var { Server, utils } = require("ssh2");
var { createRelay } = require("./relay.cjs");
var { serveSftp } = require("./sftp.cjs");
var root = path.resolve(process.argv[2] || path.join(__dirname, "config"));
var config = JSON.parse(fs.readFileSync(path.join(root, "remote.json"), "utf8"));
var allowed = utils.parseKey(fs.readFileSync(path.join(root, "client_key.pub")));
if (allowed instanceof Error) throw allowed;
var hostKey = fs.readFileSync(path.join(root, "host_key"));
var parsedHost = utils.parseKey(hostKey);
if (parsedHost instanceof Error) throw parsedHost;
var fingerprint = "SHA256:" + crypto.createHash("sha256").update(parsedHost.getPublicSSH()).digest("base64").replace(/=+$/, "");
var children = /* @__PURE__ */ new Set();
var clients = /* @__PURE__ */ new Set();
var server = new Server({ hostKeys: [hostKey] }, (client) => {
  clients.add(client);
  client.on("error", () => {
  });
  client.on("close", () => clients.delete(client));
  client.on("authentication", (ctx) => {
    if (ctx.username !== config.user || ctx.method !== "publickey" || !ctx.key.data.equals(allowed.getPublicSSH()) || ctx.signature && allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true) {
      return ctx.reject(["publickey"]);
    }
    ctx.accept();
  });
  client.on("ready", () => {
    console.log("SSH public-key authentication succeeded.");
    client.on("session", (accept) => {
      const session = accept();
      function start(accept2, command) {
        const stream = accept2();
        const windows = process.platform === "win32";
        const shell = windows ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
        const args = command === void 0 ? windows ? ["/Q"] : ["-s"] : windows ? ["/d", "/s", "/c", command] : ["-c", command];
        const child = spawn(shell, args, { cwd: os.homedir(), windowsHide: true, stdio: "pipe" });
        children.add(child);
        stream.pipe(child.stdin);
        child.stdin.on("error", () => {
        });
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
          children.delete(child);
          if (finished) return;
          finished = true;
          stream.exit(code === null ? 1 : code);
          stream.end();
        });
        stream.on("close", () => {
          if (!finished) child.kill();
        });
      }
      session.on("exec", (accept2, reject, info2) => start(accept2, info2.command));
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
server.listen(config.sshPort, "127.0.0.1", () => {
  config.sshPort = server.address().port;
  console.log("SSH service ready on loopback. Host fingerprint: " + fingerprint);
  relay = createRelay(config, "far");
  const status = { fingerprint, platform: process.platform, user: config.user, hostname: os.hostname() };
  relay.on("ready", () => {
    console.log("Public encrypted relay subscribed; waiting for near-end verification.");
    relay.status(status).catch(() => {
    });
  });
  relay.on("peer", () => relay.status(status).catch(() => {
  }));
  relay.on("offline", () => console.log("Public relay disconnected; reconnecting."));
  relay.on("diagnostic", (message) => console.error("Relay:", message));
  heartbeat = setInterval(() => relay.status(status).catch(() => {
  }), 15e3);
});
function close() {
  clearInterval(heartbeat);
  if (relay) relay.close();
  for (const child of children) child.kill();
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2e3).unref();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
