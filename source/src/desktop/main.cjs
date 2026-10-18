"use strict";
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const { fork } = require('node:child_process');
const crypto = require('node:crypto');
const { save, load, privateDirectory } = require('../paired-store.cjs');
const { createTraceWriter } = require('../diagnostics.cjs');
const argv = process.argv.slice(1);
const at = argv.indexOf('--role');
const role = at < 0 ? 'near' : argv[at + 1];
if (!['near', 'far'].includes(role)) throw new Error('Invalid endpoint role');
const si = argv.indexOf('--state-dir');
const root = path.resolve(si < 0 ? path.join(os.homedir(), '.ssh-relay-paired', role) : argv[si + 1]);
privateDirectory(root);
const desktopLog = createTraceWriter(root, 'desktop-' + role);
const errorMetadata = error => ({ name: String(error?.name || 'Error').slice(0, 60), code: String(error?.code || 'desktop_error').slice(0, 60) });
process.on('uncaughtException', error => { desktopLog({ event: 'desktop_uncaught', ...errorMetadata(error) }); app.exit(1); });
process.on('unhandledRejection', error => { desktopLog({ event: 'desktop_rejection', ...errorMetadata(error) }); app.exit(1); });
desktopLog({ event: 'desktop_started', pid: process.pid });
// Separate app identities allow one near and one far on the same desktop.
app.setPath('userData', path.join(root, 'desktop'));
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  let win, tray, agent, quitting = false, state = { role, phase: 'starting', targets: [] }, pair = null;
  let restartTimer, restartAttempt = 0;
  let agentStableTimer;
  const title = role === 'near' ? 'SSH Relay · 近端' : 'SSH Relay · 远端';
  const appRoot = path.resolve(__dirname, '../..');
  const application = path.join(appRoot, 'desktop-package');
  const startupArgs = [application, '--role', role, '--state-dir', root, '--background'];
  const startupId = 'SSHRelayPaired-' + role + '-' + crypto.createHash('sha256').update(process.platform === 'win32' ? root.toLowerCase() : root).digest('hex').slice(0, 12);
  const desktopFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', startupId + '.desktop');
  const q = arg => { if (/[\n\r\0%]/.test(arg)) throw new Error('Unsupported startup path'); return '"' + arg.replace(/[\\"`$]/g, '\\$&') + '"'; };
  const launchCommand = () => [process.execPath, ...startupArgs].map(q).join(' ');
  function loginState() {
    if (process.platform === 'win32' || process.platform === 'darwin')
      return app.getLoginItemSettings({ path: process.execPath, args: startupArgs }).openAtLogin;
    if (process.platform === 'linux') {
      if (!fs.existsSync(desktopFile)) return false;
      const text = fs.readFileSync(desktopFile, 'utf8');
      return text.includes('X-SSH-Relay-Owned=true') && text.includes('Exec=' + launchCommand() + '\n') && !text.includes('Hidden=true');
    }
    return false;
  }
  function setLogin(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid startup setting');
    if (process.platform === 'win32' || process.platform === 'darwin')
      app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: startupArgs, name: startupId });
    else if (process.platform === 'linux') {
      if (enabled) {
        fs.mkdirSync(path.dirname(desktopFile), { recursive: true, mode: 0o700 });
        if (fs.existsSync(desktopFile) && !fs.readFileSync(desktopFile, 'utf8').includes('X-SSH-Relay-Owned=true')) throw new Error('Startup name is occupied');
        fs.writeFileSync(desktopFile, '[Desktop Entry]\nType=Application\nName=' + title + '\nExec=' + launchCommand() + '\nTerminal=false\nX-SSH-Relay-Owned=true\n', { mode: 0o600 });
      } else if (fs.existsSync(desktopFile)) {
        if (!fs.readFileSync(desktopFile, 'utf8').includes('X-SSH-Relay-Owned=true')) throw new Error('Startup entry is not owned by this app');
        fs.unlinkSync(desktopFile);
      }
    } else throw new Error('Startup is unsupported on this platform');
    if (loginState() !== enabled) throw new Error('Operating system did not confirm startup registration');
    save(path.join(root, 'desktop-settings.json'), { autostart: enabled });
    desktopLog({ event: 'autostart_changed', enabled });
    return enabled;
  }
  function snapshot() { return { ...state, pairing: pair, autostart: loginState(), startupMode: '用户登录后静默启动', role }; }
  function update() {
    if (win && !win.isDestroyed()) win.webContents.send('status', snapshot());
    if (tray) {
      tray.setToolTip(title + ' · ' + state.phase);
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '打开控制面板', click: show },
        { label: '状态：' + state.phase, enabled: false },
        ...(role === 'near' ? [{ label: '自动连接已配对电脑', type: 'checkbox', checked: !!state.autoConnect, click: item => agent?.send({ action: item.checked ? 'connect' : 'pause' }) }] : []),
        { label: '登录后自启动', type: 'checkbox', checked: loginState(), click: item => { try { setLogin(item.checked); update(); } catch { show(); win.webContents.send('ui-error', '自启动注册失败，请检查系统权限'); } } },
        { label: '查看诊断目录', click: () => shell.openPath(root) },
        { type: 'separator' }, { label: '退出并停止连接', click: () => { quitting = true; app.quit(); } },
      ]));
    }
  }
  function show(visible = true) {
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({ width: 880, height: 720, minWidth: 650, minHeight: 550, title,
        icon: path.join(appRoot, 'assets', 'paired.png'), show: false,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
      win.removeMenu(); win.loadFile(path.join(__dirname, 'index.html'));
      win.once('ready-to-show', () => { if (visible) win.show(); update(); });
      win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', event => event.preventDefault());
    } else { if (visible) { win.show(); win.focus(); } update(); }
  }
  function startAgent() {
    if (quitting) return;
    agent = fork(path.join(appRoot, 'src', 'paired-agent.cjs'), ['--role', role, '--state-dir', root], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, execPath: process.execPath, silent: true, windowsHide: true,
    });
    agent.stdout.resume(); agent.stderr.resume();
    desktopLog({ event: 'agent_started', pid: agent.pid });
    agent.on('message', message => {
      if (message.type === 'status') {
        state = message.status;
        if (state.phase === 'connected' || state.phase === 'listening') {
          if (!agentStableTimer) { agentStableTimer = setTimeout(() => { restartAttempt = 0; agentStableTimer = null; }, 60000); agentStableTimer.unref(); }
        } else { clearTimeout(agentStableTimer); agentStableTimer = null; }
      }
      if (message.type === 'pairing') pair = message.pairing;
      update();
    });
    agent.on('error', error => desktopLog({ event: 'agent_start_error', ...errorMetadata(error) }));
    agent.on('exit', (code, signal) => {
      desktopLog({ event: 'agent_exit', code, signal });
      clearTimeout(agentStableTimer); agentStableTimer = null;
      agent = null; if (quitting) return;
      state = { ...state, connected: false, phase: 'manager_restarting' }; update();
      const wait = Math.min(60000, 2000 * 2 ** Math.min(restartAttempt++, 5));
      restartTimer = setTimeout(startAgent, wait);
    });
  }
  ipcMain.handle('snapshot', event => { if (event.sender !== win?.webContents) throw new Error('Invalid sender'); return snapshot(); });
  ipcMain.handle('action', (event, message) => {
    if (event.sender !== win?.webContents || !message || typeof message !== 'object') throw new Error('Invalid sender');
    if (message.action === 'startup') { const result = setLogin(message.enabled); update(); return result; }
    if (message.action === 'logs') return shell.openPath(root);
    if (!['pair', 'connect', 'pause', 'forget', 'revoke-all'].includes(message.action)) throw new Error('Unknown action');
    if (typeof message.code === 'string' && message.code.length > 100) throw new Error('Invalid code');
    if (message.target && !/^[a-f0-9]{32}$/.test(message.target)) throw new Error('Invalid target');
    if (!agent?.connected) throw new Error('Connection service is restarting');
    agent.send(message); return true;
  });
  app.on('second-instance', (_event, commandLine) => { if (!commandLine.includes('--background')) show(); });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true; clearTimeout(restartTimer); clearTimeout(agentStableTimer); agent?.send({ action: 'quit' });
    setTimeout(() => agent?.kill(), 2500).unref(); tray?.destroy();
  });
  app.whenReady().then(() => {
    desktopLog({ event: 'desktop_ready' });
    privateDirectory(root);
    tray = new Tray(nativeImage.createFromPath(path.join(appRoot, 'assets', 'paired.png')));
    tray.on('double-click', show); tray.on('click', show);
    startAgent(); update(); show(!argv.includes('--background'));
  });
}
