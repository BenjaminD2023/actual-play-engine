'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { app, BrowserWindow, ipcMain } = require('electron');
const midi = require('@julusian/midi');
const { isTriggeringMidiNote, parseMidiBytes } = require('./midi-map.cjs');

const SETTINGS_FILE = 'settings.json';
const defaultSettings = {
  serverUrl: 'https://localhost:3000',
  bridgeToken: '',
  bridgeId: `${os.hostname()}-${randomUUID().slice(0, 8)}`,
  enableDmInput: true,
  inputDevice: '__all__',
  allowSelfSigned: true,
};

let settings = { ...defaultSettings };
let mainWindow = null;
let inputPorts = [];

function settingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function loadSettings() {
  try {
    settings = { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    settings = { ...defaultSettings };
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function request(urlString, options, body) {
  const url = new URL(urlString);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        ...options,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        rejectUnauthorized: !settings.allowSelfSigned,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function postMidi(event) {
  if (!settings.serverUrl || !settings.bridgeToken) return;
  const payload = JSON.stringify({
    ...event,
    bridgeId: settings.bridgeId,
    timestamp: Date.now(),
  });
  await request(
    `${settings.serverUrl.replace(/\/$/, '')}/api/actualplay/midi/relay`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.bridgeToken}`,
      },
    },
    payload
  );
}

function openMidiInputs() {
  for (const port of inputPorts) {
    try {
      port.close();
    } catch {
      // ignore
    }
  }
  inputPorts = [];
  if (!settings.enableDmInput) return;

  const input = new midi.Input();
  const count = input.getPortCount();
  for (let i = 0; i < count; i += 1) {
    const name = input.getPortName(i);
    if (settings.inputDevice !== '__all__' && name !== settings.inputDevice) continue;
    const port = new midi.Input();
    port.on('message', (_delta, bytes) => {
      const [status, data1, data2] = bytes;
      const parsed = parseMidiBytes(status, data1, data2);
      if (!isTriggeringMidiNote(parsed.midiType, parsed.velocity, parsed.data2)) return;
      void postMidi({ ...parsed, deviceName: name, type: 'midi_event' }).catch((error) => {
        console.error('MIDI relay failed', error);
      });
    });
    port.openPort(i);
    inputPorts.push(port);
  }
  input.close();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 420,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  openMidiInputs();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('bridge:get-settings', () => settings);
ipcMain.handle('bridge:set-settings', (_event, next) => {
  settings = { ...settings, ...next };
  saveSettings();
  openMidiInputs();
  return settings;
});
