const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const store = require('electron-store');
const { AuthService } = require('./auth-service');
const { AuthLaunchService } = require('./auth-launch-service');
const { getRiotClientPath, closeRiotProcesses, isValorantRunning } = require('./auth-launch-service'); // Import helper functions

const appStore = new store();
const authService = new AuthService(appStore);
const authLaunchService = new AuthLaunchService(appStore);

let mainWindow;
let valorantProcessWatcher = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        icon: path.join(__dirname, 'assets/icon.png') // Ensure you have an icon file
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    // Open DevTools (optional)
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
        stopValorantWatcher();
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// --- IPC Handlers ---

ipcMain.handle('get-accounts', async () => {
    return authService.getAccounts();
});

ipcMain.handle('add-account', async (event, credentials) => {
    try {
        const account = await authService.addAccount(credentials.username, credentials.password);
        return { success: true, account };
    } catch (error) {
        console.error('Error adding account:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('import-current-account', async () => {
    try {
        const account = await authLaunchService.importCurrentAccount();
        if (account) {
            return { success: true, account };
        } else {
            return { success: false, error: 'Could not import account. Ensure Riot Client is running and you are logged in.' };
        }
    } catch (error) {
        console.error('Error importing account:', error);
        return { success: false, error: error.message };
    }
});


ipcMain.handle('remove-account', async (event, accountId) => {
    try {
        await authService.removeAccount(accountId);
        return { success: true };
    } catch (error) {
        console.error('Error removing account:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('launch-valorant', async (event, accountId) => {
    mainWindow.webContents.send('update-launch-status', accountId, 'launching');
    try {
        const account = authService.getAccountById(accountId); // Get full account details
        if (!account || !account.cookies || !account.cookies.ssid) {
             mainWindow.webContents.send('update-launch-status', accountId, 'error', 'Account data incomplete or missing SSID.');
            return { success: false, error: 'Account data incomplete or missing SSID.' };
        }

        const valorantPath = appStore.get('valorantPath');
        if (!valorantPath || !await getRiotClientPath()) { // Check Riot Client path too
             mainWindow.webContents.send('update-launch-status', accountId, 'error', 'Riot Client path not set or invalid.');
            dialog.showErrorBox('Error', 'Riot Client path not set or invalid. Please configure it in settings.');
            return { success: false, error: 'Riot Client path not set or invalid.' };
        }

        await authLaunchService.launchValorant(account);
        await authService.updateLastUsed(accountId); // Update last used timestamp
        startValorantWatcher(accountId); // Start watcher after successful launch command
        // Don't send 'running' status immediately, wait for watcher
        return { success: true };

    } catch (error) {
        console.error('Error launching Valorant:', error);
        mainWindow.webContents.send('update-launch-status', accountId, 'error', error.message);
        dialog.showErrorBox('Launch Error', `Failed to launch Valorant: ${error.message}`);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-settings', async () => {
    return {
        valorantPath: appStore.get('valorantPath'),
        theme: appStore.get('theme', 'system') // Default to system theme
    };
});

ipcMain.handle('save-settings', async (event, settings) => {
    if (settings.valorantPath) {
        appStore.set('valorantPath', settings.valorantPath);
    }
    if (settings.theme) {
        appStore.set('theme', settings.theme);
        // Optionally apply theme immediately if your UI supports it
        mainWindow.webContents.send('apply-theme', settings.theme);
    }
    return { success: true };
});

ipcMain.handle('select-valorant-path', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Riot Games Installation Directory'
    });
    if (!result.canceled && result.filePaths.length > 0) {
        // Basic check if it looks like a Riot Games folder
        const potentialPath = await getRiotClientPath(result.filePaths[0]);
        if (potentialPath) {
             appStore.set('valorantPath', result.filePaths[0]); // Store the selected base directory
             return { success: true, path: result.filePaths[0] };
        } else {
            dialog.showErrorBox('Invalid Path', 'Selected directory does not seem to contain a valid Riot Client installation.');
            return { success: false, error: 'Invalid path selected.' };
        }

    }
    return { success: false };
});

ipcMain.handle('open-external-link', (event, url) => {
    shell.openExternal(url);
});

// --- Helper Functions ---

function startValorantWatcher(accountId) {
    stopValorantWatcher(); // Stop any existing watcher

    let valorantFound = false;
    valorantProcessWatcher = setInterval(async () => {
        try {
            const running = await isValorantRunning();

            if (running && !valorantFound) {
                valorantFound = true;
                console.log('Valorant detected as running.');
                mainWindow.webContents.send('update-launch-status', accountId, 'running');
            } else if (!running && valorantFound) {
                console.log('Valorant detected as closed.');
                mainWindow.webContents.send('update-launch-status', accountId, 'closed');
                stopValorantWatcher(); // Stop checking once closed
            } else if (!running && !valorantFound) {
                // Still in the launching phase or launch failed before game started
                // Keep checking for a bit longer in case it's just slow to start
            }
        } catch (error) {
            console.error('Error checking Valorant process:', error);
            // Optionally stop watcher on error or handle specific errors
        }
    }, 5000); // Check every 5 seconds
}

function stopValorantWatcher() {
    if (valorantProcessWatcher) {
        clearInterval(valorantProcessWatcher);
        valorantProcessWatcher = null;
        console.log('Valorant watcher stopped.');
    }
}