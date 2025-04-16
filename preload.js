const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Account Management
    getAccounts: () => ipcRenderer.invoke('get-accounts'),
    addAccount: (credentials) => ipcRenderer.invoke('add-account', credentials),
    importCurrentAccount: () => ipcRenderer.invoke('import-current-account'),
    removeAccount: (accountId) => ipcRenderer.invoke('remove-account', accountId),
    launchValorant: (accountId) => ipcRenderer.invoke('launch-valorant', accountId),

    // Settings
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    selectValorantPath: () => ipcRenderer.invoke('select-valorant-path'),

    // UI Updates & Misc
    onUpdateLaunchStatus: (callback) => ipcRenderer.on('update-launch-status', (_event, ...args) => callback(...args)),
    onApplyTheme: (callback) => ipcRenderer.on('apply-theme', (_event, theme) => callback(theme)),
    openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),

    // Cleanup listeners when they are no longer needed (e.g., component unmount)
    removeUpdateLaunchStatusListener: () => ipcRenderer.removeAllListeners('update-launch-status'),
    removeApplyThemeListener: () => ipcRenderer.removeAllListeners('apply-theme'),
});

console.log('Preload script loaded.');