import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'zh_CN',
    action: {
      default_title: '__MSG_actionTitle__',
      default_icon: 'brand/pi_logo.png',
      default_popup: 'popup.html',
    },
    icons: {
      16: 'brand/pi_logo.png',
      32: 'brand/pi_logo.png',
      48: 'brand/pi_logo.png',
      128: 'brand/pi_logo.png',
    },
    permissions: ['storage', 'contextMenus', 'activeTab', 'scripting', 'sidePanel'],
    side_panel: {
      default_path: 'sidepanel.html',
    },
    host_permissions: ['https://www.overleaf.com/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*', 'file:///*'],
    web_accessible_resources: [
      {
        resources: ['brand/pi_logo.png'],
        matches: ['http://*/*', 'https://*/*'],
      },
    ],
    commands: {
      'translate-selection': {
        suggested_key: {
          default: 'Alt+Shift+T',
        },
        description: '__MSG_commandDescription__',
      },
    },
  },
});
