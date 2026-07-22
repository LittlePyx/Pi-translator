import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'TeX Selection Translator',
    description: 'Translate selected academic prose in Overleaf while preserving LaTeX.',
    action: {
      default_title: 'TeX Selection Translator 设置',
    },
    permissions: ['storage', 'contextMenus', 'activeTab', 'scripting'],
    host_permissions: [
      'https://api.deepseek.com/*',
      'https://www.overleaf.com/*',
    ],
    commands: {
      'translate-selection': {
        suggested_key: {
          default: 'Alt+Shift+T',
        },
        description: 'Translate the current selection',
      },
    },
  },
});
