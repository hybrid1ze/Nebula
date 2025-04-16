document.addEventListener('DOMContentLoaded', () => {
    const accountList = document.getElementById('account-list');
    const addAccountForm = document.getElementById('add-account-form');
    const addAccountStatus = document.getElementById('add-account-status');
    const importAccountBtn = document.getElementById('import-account-btn');
    const appStatus = document.getElementById('app-status');
    const discordLink = document.getElementById('discord-link');

    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const settingsForm = document.getElementById('settings-form');
    const valorantPathInput = document.getElementById('valorant-path');
    const selectPathBtn = document.getElementById('select-path-btn');
    const themeSelect = document.getElementById('theme-select');
    const settingsStatus = document.getElementById('settings-status');

    let currentTheme = 'system';

    function displayStatusMessage(element, message, type = 'info') {
        element.textContent = message;
        element.className = `status-message ${type}`;
        element.style.display = 'block';
        // Consider adding a timeout to auto-hide messages after a delay
    }

    function clearStatusMessage(element) {
        element.textContent = '';
        element.style.display = 'none';
         element.className = 'status-message';
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
            document.body.classList.add('system-theme');
        }
        currentTheme = theme;
        console.log(`Theme applied: ${theme}`);
    }

    async function loadAccounts() {
        accountList.innerHTML = '<li class="loading-placeholder">Loading accounts...</li>';
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
        accountList.innerHTML = '';
        if (accounts.length === 0) {
            accountList.innerHTML = '<li class="no-accounts-placeholder">No accounts added yet.</li>';
            return;
        }

        accounts.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)); // Show most recently used first

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
            statusIndicator.className = 'status-indicator';
            statusIndicator.id = `status-${account.id}`; // ID for targeting status updates

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.className = 'remove-btn';
            removeBtn.dataset.accountId = account.id;
            removeBtn.addEventListener('click', handleRemoveClick);

            accountActions.appendChild(launchBtn);
            accountActions.appendChild(statusIndicator);
            accountActions.appendChild(removeBtn);

            listItem.appendChild(accountInfo);
            listItem.appendChild(accountActions);
            accountList.appendChild(listItem);
        });
    }

    async function handleAddAccountSubmit(event) {
        event.preventDefault();
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const submitButton = document.getElementById('add-account-submit-btn');

        const username = usernameInput.value.trim();
        const password = passwordInput.value;

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
                addAccountForm.reset();
                await loadAccounts();
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
        clearStatusMessage(addAccountStatus);
        importAccountBtn.disabled = true;
        importAccountBtn.textContent = 'Importing...';
        updateAppStatus('Importing account...');

        try {
            const result = await window.electronAPI.importCurrentAccount();
            if (result.success) {
                displayStatusMessage(addAccountStatus, `Account "${result.account.username}" imported/updated successfully!`, 'success');
                await loadAccounts();
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
        clearStatusMessage(addAccountStatus);
        updateAppStatus(`Launching account ${accountId}...`);
        button.disabled = true;
        button.textContent = 'Launching...';

        updateLaunchStatus(accountId, 'launching'); // Set initial visual state

        try {
            const result = await window.electronAPI.launchValorant(accountId);
            if (result.success) {
                // Launch command sent successfully. Status will update via the watcher.
                console.log(`Launch command sent for account ${accountId}`);
            } else {
                // Launch command failed immediately (e.g., bad path, missing cookies)
                updateAppStatus(`Launch failed for ${accountId}.`);
                displayStatusMessage(addAccountStatus, `Launch Error: ${result.error || 'Unknown error'}`, 'error');
                button.disabled = false;
                button.textContent = 'Launch';
                updateLaunchStatus(accountId, 'error', result.error);
            }
        } catch (error) {
            // Catch errors from the IPC call itself
            console.error('IPC Error launching Valorant:', error);
            updateAppStatus(`Launch failed for ${accountId}.`);
            displayStatusMessage(addAccountStatus, `Launch Error: ${error.message}`, 'error');
            button.disabled = false;
            button.textContent = 'Launch';
            updateLaunchStatus(accountId, 'error', error.message);
        }
    }

    async function handleRemoveClick(event) {
        const accountId = event.target.dataset.accountId;
        const listItem = event.target.closest('li');
        const accountName = listItem.querySelector('.account-info strong').textContent;

        // TODO: Replace confirm() with a custom modal for better UX
        if (confirm(`Are you sure you want to remove the account "${accountName}"?`)) {
            clearStatusMessage(addAccountStatus);
            updateAppStatus(`Removing account ${accountId}...`);
            try {
                const result = await window.electronAPI.removeAccount(accountId);
                if (result.success) {
                    listItem.remove();
                    updateAppStatus(`Account ${accountId} removed.`);
                    displayStatusMessage(addAccountStatus, `Account "${accountName}" removed.`, 'success');
                    // If the list becomes empty, show the placeholder
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

    function openSettingsModal() {
        settingsModal.style.display = 'block';
        loadSettings();
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
            applyTheme(settings.theme || 'system');
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
                applyTheme(newSettings.theme);
                // Consider closing modal automatically on successful save
                // closeSettingsModal();
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
                displayStatusMessage(settingsStatus, 'Path selected. Remember to save.', 'info');
            } else if (result.error) {
                 displayStatusMessage(settingsStatus, result.error, 'error');
            }
        } catch (error) {
            console.error("Error selecting path:", error);
            displayStatusMessage(settingsStatus, 'Failed to select path.', 'error');
        }
    }

    // Updates the UI elements (button text, status dot) for a specific account based on launch status
    function updateLaunchStatus(accountId, status, message = '') {
         const statusIndicator = document.getElementById(`status-${accountId}`);
         const launchButton = document.querySelector(`.launch-btn[data-account-id="${accountId}"]`);

         if (!statusIndicator || !launchButton) return;

         statusIndicator.className = 'status-indicator'; // Reset classes first

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
                 launchButton.disabled = true;
                 launchButton.textContent = 'Running';
                 updateAppStatus(`Valorant running for account ${accountId}`);
                break;
            case 'closed':
                statusIndicator.classList.add('status-closed');
                statusIndicator.title = 'Valorant Closed';
                launchButton.disabled = false;
                launchButton.textContent = 'Launch';
                updateAppStatus(`Valorant closed for account ${accountId}`);
                break;
            case 'error':
                statusIndicator.classList.add('status-error');
                statusIndicator.title = `Error: ${message}`;
                launchButton.disabled = false;
                launchButton.textContent = 'Launch';
                updateAppStatus(`Launch Error for account ${accountId}`);
                break;
            default:
                 statusIndicator.title = 'Idle';
                 launchButton.disabled = false;
                 launchButton.textContent = 'Launch';
                 break; // Default/idle state
             }
        }


    // --- Event Listener Setup ---
    addAccountForm.addEventListener('submit', handleAddAccountSubmit);
    importAccountBtn.addEventListener('click', handleImportAccountClick);
    settingsBtn.addEventListener('click', openSettingsModal);
    closeSettingsBtn.addEventListener('click', closeSettingsModal);
    settingsForm.addEventListener('submit', handleSaveSettings);
    selectPathBtn.addEventListener('click', handleSelectPath);
    discordLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.electronAPI.openExternalLink('https://discord.gg/a9yzrw3KAm'); // Example link
    });

    // Close modal if user clicks outside the modal content area

    window.onclick = function(event) {
        if (event.target === settingsModal) {
            closeSettingsModal();
        }
    }

    // Listen for events pushed from the main process
    window.electronAPI.onUpdateLaunchStatus(updateLaunchStatus);
    window.electronAPI.onApplyTheme(applyTheme);

    // --- Initial Load ---
    loadAccounts();
    loadSettings(); // Also applies initial theme

    // Cleanup IPC listeners when the page unloads to prevent memory leaks
    window.addEventListener('beforeunload', () => {
        window.electronAPI.removeUpdateLaunchStatusListener();
        window.electronAPI.removeApplyThemeListener();
    });

});