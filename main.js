const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const store = require('electron-store');
const { AuthService } = require('./auth-service');
const { AuthLaunchService } = require('./auth-launch-service');
const { getRiotClientPath, closeRiotProcesses, isValorantRunning } = require('./auth-launch-service');

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
        icon: path.join(__dirname, 'assets/icon.png')
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    // mainWindow.webContents.openDevTools(); // Keep commented out unless needed for debugging

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
        const account = authService.getAccountById(accountId);
        // Retrieve secure cookies needed for launch service
        const cookies = await authService.retrieveCookiesSecurely(accountId);

        if (!account || !cookies || !cookies.ssid) {
             mainWindow.webContents.send('update-launch-status', accountId, 'error', 'Account data or cookies incomplete/missing.');
            return { success: false, error: 'Account data or cookies incomplete/missing.' };
        }

        const valorantPath = appStore.get('valorantPath'); // This should be the Riot Games base path
        const riotClientExists = await getRiotClientPath(); // Verify Riot Client can be found

        if (!valorantPath || !riotClientExists) {
             mainWindow.webContents.send('update-launch-status', accountId, 'error', 'Riot Client path not set or Riot Client not found.');
            dialog.showErrorBox('Error', 'Riot Client path not set or invalid. Please configure it in settings.');
            return { success: false, error: 'Riot Client path not set or Riot Client not found.' };
        }

        // Pass the retrieved secure cookies to the launch service
        await authLaunchService.launchValorant(account, cookies);
        await authService.updateLastUsed(accountId);
        startValorantWatcher(accountId); // Start watcher after successful launch command
        // 'running' status is sent by the watcher when the process is detected
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
        theme: appStore.get('theme', 'system')
    };
});

ipcMain.handle('save-settings', async (event, settings) => {
    if (settings.valorantPath) {
        appStore.set('valorantPath', settings.valorantPath);
    }
    if (settings.theme) {
        appStore.set('theme', settings.theme);
        mainWindow.webContents.send('apply-theme', settings.theme); // Notify renderer to apply theme
    }
    return { success: true };
});

ipcMain.handle('select-valorant-path', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Riot Games Installation Directory'
    });
    if (!result.canceled && result.filePaths.length > 0) {
        // Verify that a Riot Client executable can be found relative to the selected path
        const riotClientPath = await getRiotClientPath(result.filePaths[0]);
        if (riotClientPath) {
             appStore.set('valorantPath', result.filePaths[0]); // Store the selected base directory containing Riot Client
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

// Watches for Valorant process start and exit to update UI status
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
                stopValorantWatcher();
            }
            // If !running and !valorantFound, keep checking as the game might be starting slowly
        } catch (error) {
            console.error('Error checking Valorant process:', error);
            // Consider stopping watcher on persistent errors
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