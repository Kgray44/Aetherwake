const { ipcRenderer } = require('electron');
const token = process.argv.find(value => value.startsWith('--vela-api-setup-token='))?.slice('--vela-api-setup-token='.length);
let busy = false, disposed = false;
addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('configuration'), key = document.getElementById('api-key'),
    organization = document.getElementById('organization'), project = document.getElementById('project'), status = document.getElementById('status');
  const enable = value => { for (const field of form.elements) field.disabled = !value; };
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!event.isTrusted || !navigator.userActivation.isActive || !document.hasFocus() || busy || disposed || !token || !form.reportValidity()) return;
    busy = true; status.textContent = 'Saving connection…'; enable(false);
    ipcRenderer.send('vela-api-setup', { token, action: 'save', apiKey: key.value, organization: organization.value.trim(), project: project.value.trim() });
    key.value = '';
  });
  document.getElementById('cancel').addEventListener('click', event => {
    if (event.isTrusted && !busy && !disposed && token) { disposed = true; key.value = ''; ipcRenderer.send('vela-api-setup', { token, action: 'cancel' }); }
  });
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && event.isTrusted && !busy && !disposed && token) {
      event.preventDefault(); disposed = true; key.value = ''; ipcRenderer.send('vela-api-setup', { token, action: 'cancel' });
    }
  });
  ipcRenderer.on('vela-api-setup-result', (_event, value) => {
    if (disposed || !token || value?.token !== token) return;
    busy = false; enable(true); key.value = '';
    status.textContent = value.errorCode === 'api_configuration_changed' ? 'This connection changed. Close this window and open setup again.'
      : value.errorCode === 'api_configuration_invalid' ? 'Check the API key, organization and project.'
      : 'The connection could not be saved. Check protected storage and try again.';
    key.focus();
  });
  addEventListener('beforeunload', () => { disposed = true; key.value = ''; });
  key.focus(); if (token) ipcRenderer.send('vela-api-setup', { token, action: 'ready' });
}, { once: true });
