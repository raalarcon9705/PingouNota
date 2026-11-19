import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'PingouNota',
    version: '0.1.0',
    description: 'Acompanhe pagamentos e organize suas declarações de serviço.',
    permissions: ['sidePanel', 'storage', 'alarms'],
    host_permissions: [
      'https://app.adaflow.com/*',
      'https://www.asaas.com/*',
      'https://app.asaas.com/*',
      'https://app.husky.io/*',
      'https://husky.io/*',
    ],
    action: {
      default_title: 'Abrir PingouNota',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
});
