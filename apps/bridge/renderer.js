const serverUrl = document.getElementById('serverUrl');
const bridgeToken = document.getElementById('bridgeToken');
const enableDmInput = document.getElementById('enableDmInput');
const status = document.getElementById('status');

async function load() {
  const settings = await window.bridge.getSettings();
  serverUrl.value = settings.serverUrl || '';
  bridgeToken.value = settings.bridgeToken || '';
  enableDmInput.checked = Boolean(settings.enableDmInput);
}

document.getElementById('save').addEventListener('click', async () => {
  await window.bridge.setSettings({
    serverUrl: serverUrl.value.trim(),
    bridgeToken: bridgeToken.value.trim(),
    enableDmInput: enableDmInput.checked,
  });
  status.textContent = 'Saved.';
});

load();
