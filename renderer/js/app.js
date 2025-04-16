document.addEventListener('DOMContentLoaded', () => {
    const accountList = document.getElementById('account-list');
    const addAccountForm = document.getElementById('add-account-form');
    const addAccountStatus = document.getElementById('add-account-status');
    const importAccountBtn = document.getElementById('import-account-btn');
    const appStatus = document.getElementById('app-status');
    const discordLink = document.getElementById('discord-link');

    // Settings Modal Elements
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const settingsForm = document.getElementById('settings-form');
    const valorantPathInput = document.getElementById('valorant-path');
    const selectPathBtn = document.getElementById('select-path-btn');
    const themeSelect = document.getElementById('theme-select');
    const settingsStatus = document.getElementById('settings-status');

    let currentTheme = 'system'; // Default theme

    // --- Helper Functions ---
    function displayStatusMessage(element, message, type = 'info') {
        element.textContent = message;
        element.className = `status-message ${type}`; // Reset classes and add type
        element.style.display = 'block';
        // Optionally hide after a few seconds
        // setTimeout(() => { element.style.display = 'none'; }, 5000);
    }

    function clearStatusMessage(element) {
        element.textContent = '';
        element.style.display = 'none';
         element.className = 'status-message'; // Reset class
    }

    function formatTimestamp(timestamp) {
        if (!timestamp) return 'Never';
        try {
            return new Date(timestamp).toLocaleString();
        } catch (e) {
            return 'Invalid Date';
        }
    }

     function applyTheme(theme) {
        document.body.classList.remove('light-theme', 'dark-theme', 'system-theme');
        if (theme === 'light') {
            document.body.classList.add('light-theme');
        } else if (theme === 'dark') {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.add('system-theme'); // Default to system
        }
        currentTheme = theme;
        console.log(`Theme applied: ${theme}`);
    }

    // --- Account Loading and Rendering ---
    async function loadAccounts() {
        accountList.innerHTML = '<li class="loading-placeholder">Loading accounts...</li>'; // Show loading state
        try {
            const accounts = await window.electronAPI.getAccounts();
            renderAccounts(accounts);
            updateAppStatus(`Loaded ${accounts.length} accounts.`);
        } catch (error) {
            console.error('Error loading accounts:', error);
            accountList.innerHTML = '<li class="error-placeholder">Failed to load accounts.</li>';
            updateAppStatus('Error loading accounts.');
            displayStatusMessage(addAccountStatus, `Error loading accounts: ${error.message}`, 'error');
        }
    }

    function renderAccounts(accounts) {
        accountList.innerHTML = ''; // Clear previous list
        if (accounts.length === 0) {
            accountList.innerHTML = '<li class="no-accounts-placeholder">No accounts added yet.</li>';
            return;
        }

        accounts.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)); // Sort by last used

        accounts.forEach(account => {
            const listItem = document.createElement('li');
            listItem.dataset.accountId = account.id;

            const accountInfo = document.createElement('div');
            accountInfo.className = 'account-info';
            accountInfo.innerHTML = `
                <strong>${account.username || 'Unknown User'}</strong>
                <span>Region: ${account.region || 'N/A'}</span>
                <span>Last Used: ${formatTimestamp(account.lastUsed)}</span>
            `;

            const accountActions = document.createElement('div');
            accountActions.className = 'account-actions';

            const launchBtn = document.createElement('button');
            launchBtn.textContent = 'Launch';
            launchBtn.className = 'launch-btn';
            launchBtn.dataset.accountId = account.id;
            launchBtn.addEventListener('click', handleLaunchClick);

            const statusIndicator = document.createElement('span');
            statusIndicator.className = 'status-indicator'; // Base class
            statusIndicator.id = `status-${account.id}`; // Unique ID for updates

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.className = 'remove-btn';
            removeBtn.dataset.accountId = account.id;
            removeBtn.addEventListener('click', handleRemoveClick);

            accountActions.appendChild(launchBtn);
            accountActions.appendChild(statusIndicator); // Add indicator next to launch
            accountActions.appendChild(removeBtn);

            listItem.appendChild(accountInfo);
            listItem.appendChild(accountActions);
            accountList.appendChild(listItem);
        });
    }

    // --- Event Handlers ---
    async function handleAddAccountSubmit(event) {
        event.preventDefault();
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const submitButton = document.getElementById('add-account-submit-btn');

        const username = usernameInput.value.trim();
        const password = passwordInput.value; // Don't trim password

        if (!username || !password) {
            displayStatusMessage(addAccountStatus, 'Username and password are required.', 'error');
            return;
        }

        clearStatusMessage(addAccountStatus);
        submitButton.disabled = true;
        submitButton.textContent = 'Adding...';
        updateAppStatus('Adding account...');

        try {
            const result = await window.electronAPI.addAccount({ username, password });
            if (result.success) {
                displayStatusMessage(addAccountStatus, `Account "${result.account.username}" added successfully!`, 'success');
                addAccountForm.reset(); // Clear form
                await loadAccounts(); // Refresh list
            } else {
                displayStatusMessage(addAccountStatus, `Error: ${result.error || 'Failed to add account.'}`, 'error');
            }
        } catch (error) {
            console.error('Error adding account:', error);
            displayStatusMessage(addAccountStatus, `Error: ${error.message}`, 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Add Account';
            updateAppStatus('Idle');
        }
    }

     async function handleImportAccountClick() {
        clearStatusMessage(addAccountStatus); // Use the same status area for feedback
        importAccountBtn.disabled = true;
        importAccountBtn.textContent = 'Importing...';
        updateAppStatus('Importing account...');

        try {
            const result = await window.electronAPI.importCurrentAccount();
            if (result.success) {
                displayStatusMessage(addAccountStatus, `Account "${result.account.username}" imported/updated successfully!`, 'success');
                await loadAccounts(); // Refresh list
            } else {
                displayStatusMessage(addAccountStatus, `Error: ${result.error || 'Failed to import account.'}`, 'error');
            }
        } catch (error) {
            console.error('Error importing account:', error);
            displayStatusMessage(addAccountStatus, `Error: ${error.message}`, 'error');
        } finally {
            importAccountBtn.disabled = false;
            importAccountBtn.textContent = 'Import Current';
            updateAppStatus('Idle');
        }
    }


    async function handleLaunchClick(event) {
        const button = event.target;
        const accountId = button.dataset.accountId;
        clearStatusMessage(addAccountStatus); // Clear any previous messages
        updateAppStatus(`Launching account ${accountId}...`);
        button.disabled = true;
        button.textContent = 'Launching...';

        // Reset status indicator
        updateLaunchStatus(accountId, 'launching');


        try {
            const result = await window.electronAPI.launchValorant(accountId);
            if (result.success) {
                // Don't update status here, wait for the watcher update
                console.log(`Launch command sent for account ${accountId}`);
                // Button remains disabled until game closes or error occurs
            } else {
                updateAppStatus(`Launch failed for ${accountId}.`);
                displayStatusMessage(addAccountStatus, `Launch Error: ${result.error || 'Unknown error'}`, 'error');
                button.disabled = false; // Re-enable button on failure
                button.textContent = 'Launch';
                updateLaunchStatus(accountId, 'error', result.error); // Show error status
            }
        } catch (error) {
            console.error('Error launching Valorant:', error);
            updateAppStatus(`Launch failed for ${accountId}.`);
            displayStatusMessage(addAccountStatus, `Launch Error: ${error.message}`, 'error');
            button.disabled = false; // Re-enable button on failure
            button.textContent = 'Launch';
            updateLaunchStatus(accountId, 'error', error.message); // Show error status
        }
    }

    async function handleRemoveClick(event) {
        const accountId = event.target.dataset.accountId;
        const listItem = event.target.closest('li');
        const accountName = listItem.querySelector('.account-info strong').textContent;

        // Simple confirmation dialog (replace with a nicer modal if desired)
        if (confirm(`Are you sure you want to remove the account "${accountName}"?`)) {
            clearStatusMessage(addAccountStatus);
            updateAppStatus(`Removing account ${accountId}...`);
            try {
                const result = await window.electronAPI.removeAccount(accountId);
                if (result.success) {
                    listItem.remove(); // Remove from UI immediately
                    updateAppStatus(`Account ${accountId} removed.`);
                    displayStatusMessage(addAccountStatus, `Account "${accountName}" removed.`, 'success');
                     // Check if list is now empty
                    if (accountList.children.length === 0) {
                        accountList.innerHTML = '<li class="no-accounts-placeholder">No accounts added yet.</li>';
                    }
                } else {
                    updateAppStatus(`Failed to remove ${accountId}.`);
                    displayStatusMessage(addAccountStatus, `Error: ${result.error || 'Failed to remove account.'}`, 'error');
                }
            } catch (error) {
                console.error('Error removing account:', error);
                updateAppStatus(`Failed to remove ${accountId}.`);
                displayStatusMessage(addAccountStatus, `Error: ${error.message}`, 'error');
            }
        }
    }

    function updateAppStatus(message) {
        appStatus.textContent = message;
    }

    // --- Settings Modal Logic ---
    function openSettingsModal() {
        settingsModal.style.display = 'block';
        loadSettings(); // Load current settings when opening
        clearStatusMessage(settingsStatus);
    }

    function closeSettingsModal() {
        settingsModal.style.display = 'none';
    }

    async function loadSettings() {
        try {
            const settings = await window.electronAPI.getSettings();
            valorantPathInput.value = settings.valorantPath || '';
            themeSelect.value = settings.theme || 'system';
            applyTheme(settings.theme || 'system'); // Apply loaded theme
        } catch (error) {
            console.error("Error loading settings:", error);
            displayStatusMessage(settingsStatus, 'Error loading settings.', 'error');
        }
    }

    async function handleSaveSettings(event) {
        event.preventDefault();
        const newSettings = {
            valorantPath: valorantPathInput.value,
            theme: themeSelect.value
        };
        clearStatusMessage(settingsStatus);
        updateAppStatus('Saving settings...');

        try {
            const result = await window.electronAPI.saveSettings(newSettings);
            if (result.success) {
                displayStatusMessage(settingsStatus, 'Settings saved successfully!', 'success');
                applyTheme(newSettings.theme); // Apply the new theme immediately
                // Optionally close modal on save: closeSettingsModal();
            } else {
                 displayStatusMessage(settingsStatus, 'Failed to save settings.', 'error');
            }
        } catch (error) {
             console.error("Error saving settings:", error);
             displayStatusMessage(settingsStatus, `Error: ${error.message}`, 'error');
        } finally {
             updateAppStatus('Idle');
        }
    }

    async function handleSelectPath() {
        clearStatusMessage(settingsStatus);
        try {
            const result = await window.electronAPI.selectValorantPath();
            if (result.success && result.path) {
                valorantPathInput.value = result.path;
                displayStatusMessage(settingsStatus, 'Path selected. Remember to save.', 'info'); // Use info type
            } else if (result.error) {
                 displayStatusMessage(settingsStatus, result.error, 'error');
            }
        } catch (error) {
            console.error("Error selecting path:", error);
            displayStatusMessage(settingsStatus, 'Failed to select path.', 'error');
        }
    }

    // --- IPC Listeners ---
    function updateLaunchStatus(accountId, status, message = '') {
         const statusIndicator = document.getElementById(`status-${accountId}`);
         const launchButton = document.querySelector(`.launch-btn[data-account-id="${accountId}"]`);

         if (!statusIndicator || !launchButton) return;

         // Reset classes
         statusIndicator.className = 'status-indicator';

         switch (status) {
            case 'launching':
                statusIndicator.classList.add('status-launching');
                statusIndicator.title = 'Launching...';
                launchButton.disabled = true;
                launchButton.textContent = 'Launching...';
                break;
            case 'running':
                statusIndicator.classList.add('status-running');
                statusIndicator.title = 'Valorant Running';
                 launchButton.disabled = true; // Keep disabled while running
                 launchButton.textContent = 'Running';
                 updateAppStatus(`Valorant running for account ${accountId}`);
                break;
            case 'closed':
                statusIndicator.classList.add('status-closed');
                statusIndicator.title = 'Valorant Closed';
                launchButton.disabled = false; // Re-enable button
                launchButton.textContent = 'Launch';
                updateAppStatus(`Valorant closed for account ${accountId}`);
                break;
            case 'error':
                statusIndicator.classList.add('status-error');
                statusIndicator.title = `Error: ${message}`;
                launchButton.disabled = false; // Re-enable button on error
                launchButton.textContent = 'Launch';
                 updateAppStatus(`Launch Error for account ${accountId}`);
                break;
            default:
                 statusIndicator.title = 'Idle';
                 launchButton.disabled = false;
                 launchButton.textContent = 'Launch';
                 break; // No specific class for idle/default
         }
    }


    // --- Initialization ---
    addAccountForm.addEventListener('submit', handleAddAccountSubmit);
    importAccountBtn.addEventListener('click', handleImportAccountClick);
    settingsBtn.addEventListener('click', openSettingsModal);
    closeSettingsBtn.addEventListener('click', closeSettingsModal);
    settingsForm.addEventListener('submit', handleSaveSettings);
    selectPathBtn.addEventListener('click', handleSelectPath);
    discordLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.electronAPI.openExternalLink('https://discord.gg/a9yzrw3KAm'); // Replace with actual link if different
    });


    // Close modal if clicked outside content
    window.onclick = function(event) {
        if (event.target == settingsModal) {
            closeSettingsModal();
        }
    }

    // Listen for status updates from main process
    window.electronAPI.onUpdateLaunchStatus(updateLaunchStatus);

    // Listen for theme changes from main process (if settings are changed elsewhere)
    window.electronAPI.onApplyTheme(applyTheme);


    // Initial Load
    loadAccounts();
    loadSettings(); // Load and apply theme on startup

    // Cleanup listeners on window unload (optional but good practice)
    window.addEventListener('beforeunload', () => {
        window.electronAPI.removeUpdateLaunchStatusListener();
        window.electronAPI.removeApplyThemeListener();
    });

});