const { safeStorage } = require('electron');
const keytar = require('keytar'); // Using keytar for more robust secure storage
const fetch = require('node-fetch'); // For potential future API calls, though not used for basic auth here
const { v4: uuidv4 } = require('uuid');

const SERVICE_NAME = 'ValorantAccountManager';

class AuthService {
    constructor(store) {
        this.store = store;
        this.accounts = this.store.get('accounts', []);
        // Ensure safeStorage is available before using it
        if (!safeStorage.isEncryptionAvailable()) {
            console.warn('Warning: Encryption is not available. Credentials will not be stored securely.');
        }
    }

    async getAccounts() {
        // Return accounts without sensitive data like cookies by default
        return this.accounts.map(({ cookies, ...rest }) => rest);
    }

    getAccountById(accountId) {
        // This internal method returns the full account object including cookies
        return this.accounts.find(acc => acc.id === accountId);
    }

    async addAccount(username, password) {
        // IMPORTANT: This is a placeholder for actual Riot authentication.
        // You would need a library like RadiantConnect or similar to perform
        // the real RSO authentication flow (username/password -> cookies).
        // This example simulates getting cookies after a successful login.
        // Replace this with a real implementation.

        console.warn("Using placeholder authentication - replace with actual Riot auth flow!");

        // --- Placeholder Start ---
        // Simulate fetching cookies after successful auth
        const simulatedCookies = {
            ssid: `simulated_ssid_${uuidv4()}`,
            clid: `simulated_clid_${uuidv4()}`,
            csid: `simulated_csid_${uuidv4()}`,
            tdid: `simulated_tdid_${uuidv4()}`,
            sub: `simulated_sub_${uuidv4()}` // The 'sub' cookie usually contains the Riot User ID (PUUID)
        };
        // --- Placeholder End ---

        const accountId = simulatedCookies.sub; // Use the simulated PUUID as the ID

        if (this.accounts.some(acc => acc.id === accountId)) {
            throw new Error('Account already exists.');
        }

        const newAccount = {
            id: accountId,
            username: username, // Store username for display
            region: 'NA', // Placeholder: Region should ideally be determined during auth
            lastUsed: null,
            createdAt: Date.now(),
            // We don't store the password directly. Cookies are stored securely.
            cookies: simulatedCookies // Store the obtained cookies
        };

        // Securely store cookies using keytar
        await this.storeCookiesSecurely(accountId, simulatedCookies);

        // Add account metadata (without cookies) to the store
        this.accounts.push({ ...newAccount, cookies: undefined }); // Don't save cookies directly in the store JSON
        this.store.set('accounts', this.accounts);

        return { ...newAccount, cookies: undefined }; // Return account metadata
    }

     async addImportedAccount(accountData) {
        if (!accountData || !accountData.id || !accountData.cookies || !accountData.cookies.ssid) {
            throw new Error('Invalid account data for import.');
        }

        const accountId = accountData.id;

        if (this.accounts.some(acc => acc.id === accountId)) {
             console.log(`Account ${accountId} already exists. Updating cookies.`);
             // Update cookies for existing account
             await this.storeCookiesSecurely(accountId, accountData.cookies);
             const existingAccountIndex = this.accounts.findIndex(acc => acc.id === accountId);
             if (existingAccountIndex > -1) {
                 // Update metadata if needed (e.g., username if it changed, though unlikely with import)
                 this.accounts[existingAccountIndex].region = accountData.region || this.accounts[existingAccountIndex].region;
                 // Don't update lastUsed or createdAt on import/update
                 this.store.set('accounts', this.accounts);
                 return { ...this.accounts[existingAccountIndex], cookies: undefined };
             }
             // Should not happen if accountId exists, but handle defensively
             return null;

        } else {
            // Add new account
            const newAccount = {
                id: accountId,
                username: accountData.username || `Imported Account (${accountId.substring(0, 5)})`, // Use username if available, else generate one
                region: accountData.region || 'NA', // Determine region if possible
                lastUsed: null,
                createdAt: Date.now(),
                cookies: accountData.cookies // Store the obtained cookies
            };

            await this.storeCookiesSecurely(accountId, newAccount.cookies);

            this.accounts.push({ ...newAccount, cookies: undefined });
            this.store.set('accounts', this.accounts);
            return { ...newAccount, cookies: undefined };
        }
    }


    async removeAccount(accountId) {
        this.accounts = this.accounts.filter(acc => acc.id !== accountId);
        this.store.set('accounts', this.accounts);
        // Remove securely stored cookies
        try {
            await keytar.deletePassword(SERVICE_NAME, accountId);
        } catch (error) {
            console.error(`Failed to delete secure cookies for account ${accountId}:`, error);
            // Continue even if deletion fails, as the account is removed from the list
        }
    }

    async updateLastUsed(accountId) {
        const accountIndex = this.accounts.findIndex(acc => acc.id === accountId);
        if (accountIndex > -1) {
            this.accounts[accountIndex].lastUsed = Date.now();
            this.store.set('accounts', this.accounts);
        }
    }

    // --- Secure Cookie Storage ---

    async storeCookiesSecurely(accountId, cookies) {
        if (!cookies || typeof cookies !== 'object') {
            throw new Error('Invalid cookies object provided.');
        }
        try {
            const serializedCookies = JSON.stringify(cookies);
            await keytar.setPassword(SERVICE_NAME, accountId, serializedCookies);
            console.log(`Securely stored cookies for account ${accountId}`);
        } catch (error) {
            console.error(`Failed to store secure cookies for account ${accountId}:`, error);
            throw new Error('Failed to securely store account credentials.');
        }
    }

    async retrieveCookiesSecurely(accountId) {
        try {
            const serializedCookies = await keytar.getPassword(SERVICE_NAME, accountId);
            if (serializedCookies) {
                return JSON.parse(serializedCookies);
            }
            return null; // No cookies found for this account
        } catch (error) {
            console.error(`Failed to retrieve secure cookies for account ${accountId}:`, error);
            throw new Error('Failed to retrieve account credentials.');
        }
    }
}

module.exports = { AuthService };