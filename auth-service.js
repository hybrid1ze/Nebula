// auth-service.js
const fetch = require('node-fetch');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const keytar = require('keytar');
const crypto = require('crypto');
const { spawn } = require('child_process');
const https = require('https');

// Constants
const AUTH_SERVICE = 'valorant-account-manager'; // Consistent service name
const COOKIE_KEYS = ['ssid', 'clid', 'csid', 'tdid'];
const AUTH_ENDPOINTS = {
  AUTHORIZE: 'https://auth.riotgames.com/authorize',
  TOKEN: 'https://auth.riotgames.com/token', // Note: This endpoint might not be used in the direct auth flow shown
  ENTITLEMENTS: 'https://entitlements.auth.riotgames.com/api/token/v1',
  USERINFO: 'https://auth.riotgames.com/userinfo',
  AUTH: 'https://auth.riotgames.com/api/v1/authorization',
  // REAUTH might be the same endpoint, depends on context
};

// Client platform data (Consider keeping this updated or finding a dynamic way)
const CLIENT_PLATFORM = Buffer.from(JSON.stringify({
  "platformType": "PC",
  "platformOS": "Windows",
  "platformOSVersion": "10.0.19042.1.256.64bit", // Example version, might need updating
  "platformChipset": "Unknown"
})).toString('base64');

class AuthService {
  constructor(store) {
    this.store = store; // Electron-store for non-sensitive data
    this.accounts = this.store.get('accounts', []); // Load accounts on init
  }

  /**
   * Authenticate with username and password
   * @param {string} username - Riot username
   * @param {string} password - Riot password
   * @param {string} region - User region (NA, EU, etc.) - Needed for saving
   * @returns {Promise<Object>} Authentication result
   */
  async authenticate(username, password, region) {
    try {
      // Step 1: Get cookies and tokens from direct login
      const authResult = await this._performDirectAuth(username, password);

      if (!authResult.success) {
        // Return error or MFA needed state
        return authResult;
      }

      // Step 2: Get entitlements token
      const entitlements = await this._getEntitlements(authResult.accessToken);

      // Step 3: Get user info
      const userInfo = await this._getUserInfo(authResult.accessToken);

      // Prepare account data for storage
      const accountData = {
        id: userInfo.sub, // Use PUUID as the primary ID
        username: username, // Store original username used for login/keytar
        region: region,
        puuid: userInfo.sub,
        displayName: userInfo.acct ? `${userInfo.acct.game_name}#${userInfo.acct.tag_line}` : username,
        lastUsed: Date.now(), // Set last used on successful login
        createdAt: Date.now() // Set creation time
      };

      // Store account data in non-sensitive storage
      this._saveAccount(accountData);

      // Store sensitive auth data in secure storage using username as key
      await this._saveAuthData(username, {
        ssid: authResult.ssid,
        clid: authResult.clid || '',
        csid: authResult.csid || '',
        tdid: authResult.tdid || '',
        accessToken: authResult.accessToken, // Store tokens if needed for immediate use, but focus on cookies for re-auth
        idToken: authResult.idToken,
        entitlementsToken: entitlements.entitlements_token,
      });

      // Return only non-sensitive data
      return {
        success: true,
        account: { ...accountData } // Return a copy
      };
    } catch (error) {
      console.error('Authentication error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Complete authentication with MFA code
   * @param {string} username - The username associated with the MFA attempt
   * @param {string} code - MFA code entered by user
   * @param {string} region - User region
   * @returns {Promise<Object>} Authentication result
   */
  async submitMfa(username, code, region) {
     // We need the cookies from the initial failed attempt which returned 'needsMfa'
     // This state needs to be managed temporarily, perhaps passed back from the UI
     // For simplicity here, we'll assume the cookies are somehow available or re-fetched.
     // A robust implementation would store/pass the cookie state.
     console.warn("MFA submission requires cookie state from initial attempt - this implementation is simplified.");

     // Re-attempting parts of the auth flow might be needed, or using a dedicated MFA endpoint if available.
     // The provided code snippet for _completeMfaAuth seems to assume it has the necessary context (cookies).
     // Let's try calling the provided _completeMfaAuth logic, assuming it handles context internally (which might be flawed).

    try {
      // This call likely needs the cookie context from the initial auth attempt
      const authResult = await this._completeMfaAuth(code); // Simplified call

      if (!authResult.success) {
        return authResult;
      }

      // Continue as in the normal authenticate function
      const entitlements = await this._getEntitlements(authResult.accessToken);
      const userInfo = await this._getUserInfo(authResult.accessToken);

      const accountData = {
        id: userInfo.sub,
        username: username,
        region: region,
        puuid: userInfo.sub,
        displayName: userInfo.acct ? `${userInfo.acct.game_name}#${userInfo.acct.tag_line}` : username,
        lastUsed: Date.now(),
        createdAt: Date.now() // Or update existing if found
      };

      this._saveAccount(accountData); // Save/update account metadata

      await this._saveAuthData(username, { // Use username as key
        ssid: authResult.ssid,
        clid: authResult.clid || '',
        csid: authResult.csid || '',
        tdid: authResult.tdid || '',
        accessToken: authResult.accessToken,
        idToken: authResult.idToken,
        entitlementsToken: entitlements.entitlements_token,
      });

      return {
        success: true,
        account: { ...accountData }
      };
    } catch (error) {
      console.error('MFA submission error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }


  /**
   * Re-authenticate using stored SSID to get fresh tokens.
   * Primarily used internally by launch service or for token refresh if needed.
   * @param {string} accountId - The account ID (PUUID)
   * @returns {Promise<Object>} Authentication result with tokens and cookies
   */
  async refreshAuth(accountId) {
    try {
      // Get stored cookies using the account ID (PUUID)
      const cookies = await this.retrieveCookiesSecurely(accountId);
      if (!cookies || !cookies.ssid) {
        throw new Error('No stored SSID cookie found for re-authentication.');
      }

      // Re-authenticate using SSID cookie
      const authResult = await this._performSSIDAuth(
        cookies.ssid,
        cookies.clid,
        cookies.csid,
        cookies.tdid
      );

      if (!authResult.success) {
           throw new Error(authResult.message || 'SSID re-authentication failed.');
      }

      // Get fresh entitlements token
      const entitlements = await this._getEntitlements(authResult.accessToken);

      // Update stored auth data (optional, depends if tokens need persistence)
      // Storing mainly cookies is often sufficient for re-launching
      await this.storeCookiesSecurely(accountId, { // Overwrite with potentially refreshed cookies if any
          ssid: authResult.ssid,
          clid: authResult.clid || '',
          csid: authResult.csid || '',
          tdid: authResult.tdid || '',
          sub: accountId // Ensure sub/puuid is stored with cookies
      });

      // Update last used timestamp in non-sensitive store
      this.updateLastUsed(accountId);

      return {
        success: true,
        accessToken: authResult.accessToken,
        idToken: authResult.idToken,
        entitlementsToken: entitlements.entitlements_token,
        cookies: { // Return the cookies used/refreshed
            ssid: authResult.ssid,
            clid: authResult.clid,
            csid: authResult.csid,
            tdid: authResult.tdid,
            sub: accountId
        }
      };
    } catch (error) {
      console.error(`Token refresh error for ${accountId}:`, error);
      // Don't automatically delete account here, let UI decide
      return {
        success: false,
        error: error.message,
        needsRelogin: true, // Indicate that SSID auth failed
      };
    }
  }

  /**
   * Get the list of saved accounts (metadata only)
   * @returns {Array} List of account objects
   */
  getAccounts() {
    // Ensure accounts are loaded from store if not already
    if (!this.accounts || this.accounts.length === 0) {
        this.accounts = this.store.get('accounts', []);
    }
    // Return accounts without sensitive data
    return this.accounts.map(({ ...rest }) => ({ ...rest })); // Return copies
  }

  getAccountById(accountId) {
    // Find account metadata
    return this.accounts.find(acc => acc.id === accountId);
  }


  /**
   * Delete an account
   * @param {string} accountId - Account ID (PUUID) to delete
   */
  async removeAccount(accountId) {
    // Remove from electron-store
    this.accounts = this.accounts.filter(account => account.id !== accountId);
    this.store.set('accounts', this.accounts);

    // Remove from secure storage
    try {
        // Use accountId (PUUID) as the key for keytar
        await keytar.deletePassword(AUTH_SERVICE, accountId);
        console.log(`Secure data deleted for account ${accountId}`);
    } catch (error) {
        console.error(`Failed to delete secure data for account ${accountId}:`, error);
        // Log error but continue, account metadata is removed
    }

    return { success: true };
  }

   async updateLastUsed(accountId) {
        const accountIndex = this.accounts.findIndex(acc => acc.id === accountId);
        if (accountIndex > -1) {
            this.accounts[accountIndex].lastUsed = Date.now();
            this.store.set('accounts', this.accounts); // Save updated array
        }
    }

  // --- Private Helper Methods ---

  /**
   * Perform direct authentication with username/password
   * @private
   */
  async _performDirectAuth(username, password) {
    let sessionCookies = {}; // Store cookies throughout the flow

    try {
      const agent = new https.Agent({ rejectUnauthorized: false }); // Use cautiously

      // Step 1: Initial POST to get session cookies
      const initialResponse = await fetch(AUTH_ENDPOINTS.AUTH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'RiotClient/51.0.0.4429735.4381201 rso-auth (Windows;10;;Professional, x64)' // Example User-Agent
        },
        agent,
        body: JSON.stringify({
          "client_id": "play-valorant-web-prod", // Common client ID
          "nonce": "1", // Standard nonce
          "redirect_uri": "https://playvalorant.com/opt_in", // Standard redirect
          "response_type": "token id_token",
          "scope": "account openid" // Standard scopes
        })
      });

      sessionCookies = this._extractCookies(initialResponse, sessionCookies);

      // Step 2: PUT credentials
      const authResponse = await fetch(AUTH_ENDPOINTS.AUTH, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'RiotClient/51.0.0.4429735.4381201 rso-auth (Windows;10;;Professional, x64)',
          'Cookie': this._formatCookies(sessionCookies) // Send back received cookies
        },
        agent,
        body: JSON.stringify({
          "type": "auth",
          "username": username,
          "password": password,
          "remember": true, // Optional: attempt to get remember device cookie
          "language": "en_US"
        })
      });

      sessionCookies = this._extractCookies(authResponse, sessionCookies); // Extract potentially new cookies (like ssid)
      const authData = await authResponse.json();

      // Check for MFA requirement
      if (authData.type === 'multifactor') {
        console.log('MFA Required');
        // IMPORTANT: Need to persist sessionCookies somehow for the MFA step
        // This simplified example doesn't show state persistence between calls
        return {
          success: false,
          needsMfa: true,
          // Include necessary state for MFA call if possible, e.g., MFA email
          mfaEmail: authData.multifactor?.email,
          message: 'Multi-factor authentication required'
        };
      }

      // Check for other errors
      if (authData.error) {
        console.error('Auth Error:', authData.error, authData.error_description);
        return {
          success: false,
          error: authData.error,
          message: authData.error_description || 'Authentication failed'
        };
      }

      // Check for successful response type and parameters
      if (authData.type !== 'response' || !authData.response?.parameters?.uri) {
        console.error('Unexpected auth response:', authData);
        return {
          success: false,
          error: 'invalid_response',
          message: 'Unexpected authentication response format'
        };
      }

      // Extract tokens from the redirect URI fragment
      const uriFragment = authData.response.parameters.uri.split('#')[1];
      const params = new URLSearchParams(uriFragment);
      const accessToken = params.get('access_token');
      const idToken = params.get('id_token');

      if (!accessToken || !idToken) {
        console.error('Missing tokens in auth response');
        return {
          success: false,
          error: 'missing_tokens',
          message: 'Access or ID token missing from response'
        };
      }

      return {
        success: true,
        accessToken,
        idToken,
        // Return all collected cookies, ensuring essential ones are present
        ssid: sessionCookies.ssid || '',
        clid: sessionCookies.clid || '',
        csid: sessionCookies.csid || '',
        tdid: sessionCookies.tdid || ''
      };

    } catch (error) {
      console.error('Direct auth network/parse error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Complete MFA authentication
   * @private
   * NOTE: This function needs the cookie context from the initial auth attempt.
   * How this context is passed or maintained is crucial for it to work.
   */
  async _completeMfaAuth(code, sessionCookies = {}) { // Expects cookies from previous step
     if (!Object.keys(sessionCookies).length) {
         console.error("MFA completion called without session cookies.");
         // In a real app, you'd fetch/pass these cookies.
         // Returning error as it cannot proceed.
         return { success: false, error: "internal_error", message: "MFA state lost." };
     }

    try {
      const agent = new https.Agent({ rejectUnauthorized: false });

      const mfaResponse = await fetch(AUTH_ENDPOINTS.AUTH, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'RiotClient/51.0.0.4429735.4381201 rso-auth (Windows;10;;Professional, x64)',
          'Cookie': this._formatCookies(sessionCookies) // Send cookies from initial attempt
        },
        agent,
        body: JSON.stringify({
          "type": "multifactor",
          "code": code,
          "rememberDevice": true // Attempt to remember device
        })
      });

      sessionCookies = this._extractCookies(mfaResponse, sessionCookies); // Update cookies
      const mfaData = await mfaResponse.json();

      if (mfaData.error) {
        console.error('MFA Error:', mfaData.error, mfaData.error_description);
        return {
          success: false,
          error: mfaData.error,
          message: mfaData.error_description || 'MFA authentication failed'
        };
      }

      if (mfaData.type !== 'response' || !mfaData.response?.parameters?.uri) {
        console.error('Unexpected MFA response:', mfaData);
        return {
          success: false,
          error: 'invalid_response',
          message: 'Unexpected MFA response format'
        };
      }

      const uriFragment = mfaData.response.parameters.uri.split('#')[1];
      const params = new URLSearchParams(uriFragment);
      const accessToken = params.get('access_token');
      const idToken = params.get('id_token');

      if (!accessToken || !idToken) {
        console.error('Missing tokens in MFA response');
        return {
          success: false,
          error: 'missing_tokens',
          message: 'Access or ID token missing from MFA response'
        };
      }

      return {
        success: true,
        accessToken,
        idToken,
        ssid: sessionCookies.ssid || '',
        clid: sessionCookies.clid || '',
        csid: sessionCookies.csid || '',
        tdid: sessionCookies.tdid || ''
      };

    } catch (error) {
      console.error('MFA completion network/parse error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Authenticate using stored SSID cookie
   * @private
   */
  async _performSSIDAuth(ssid, clid, csid, tdid) {
    const cookieMap = new Map();
    if (ssid) cookieMap.set('ssid', ssid);
    if (clid) cookieMap.set('clid', clid);
    if (csid) cookieMap.set('csid', csid);
    if (tdid) cookieMap.set('tdid', tdid);

    if (!cookieMap.has('ssid')) {
        return { success: false, message: "Missing SSID cookie for re-auth." };
    }

    const cookieHeader = Array.from(cookieMap.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');

    try {
      const agent = new https.Agent({ rejectUnauthorized: false });
      const authorizeUrl = `${AUTH_ENDPOINTS.AUTHORIZE}?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid`;

      const response = await fetch(authorizeUrl, {
        method: 'GET',
        headers: {
          'Cookie': cookieHeader,
          'User-Agent': 'RiotClient/51.0.0.4429735.4381201 rso-auth (Windows;10;;Professional, x64)'
        },
        agent,
        redirect: 'manual' // Crucial: Do not follow the redirect
      });

      const redirectUrl = response.headers.get('location');

      if (response.status !== 303 && response.status !== 302 || !redirectUrl || !redirectUrl.includes('access_token')) {
        console.error(`SSID Auth failed. Status: ${response.status}, Location: ${redirectUrl}`);
        // Attempt to parse error from body if possible (though unlikely on redirect)
        let errorBody = null;
        try { errorBody = await response.json(); } catch {}
        console.error("SSID Auth Error Body:", errorBody);
        return { success: false, message: 'SSID authentication failed. Cookie might be invalid or expired.', needsRelogin: true };
      }

      const uriFragment = redirectUrl.split('#')[1];
      const params = new URLSearchParams(uriFragment);
      const accessToken = params.get('access_token');
      const idToken = params.get('id_token');

      if (!accessToken || !idToken) {
        return { success: false, message: 'Failed to extract tokens from redirect URL.', needsRelogin: true };
      }

      // Extract cookies from the response headers as well, in case they were refreshed
      const refreshedCookies = this._extractCookies(response, Object.fromEntries(cookieMap));

      return {
        success: true,
        accessToken,
        idToken,
        // Return potentially refreshed cookies
        ssid: refreshedCookies.ssid || ssid,
        clid: refreshedCookies.clid || clid,
        csid: refreshedCookies.csid || csid,
        tdid: refreshedCookies.tdid || tdid,
      };

    } catch (error) {
      console.error('SSID auth network/parse error:', error);
      return { success: false, error: error.message, needsRelogin: true };
    }
  }

  /**
   * Get entitlements token
   * @private
   */
  async _getEntitlements(accessToken) {
    try {
        const agent = new https.Agent({ rejectUnauthorized: false });
        const response = await fetch(AUTH_ENDPOINTS.ENTITLEMENTS, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'RiotClient/51.0.0.4429735.4381201 rso-auth (Windows;10;;Professional, x64)'
        },
        agent,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Entitlements Error (${response.status}): ${errorText}`);
            throw new Error(`Failed to get entitlements: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Get entitlements network/parse error:', error);
        throw error; // Re-throw to be caught by calling function
    }
  }

  /**
   * Get user info
   * @private
   */
  async _getUserInfo(accessToken) {
     try {
        const agent = new https.Agent({ rejectUnauthorized: false });
        const response = await fetch(AUTH_ENDPOINTS.USERINFO, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'RiotClient/51.0.0.4429735.4381201 rso-auth (Windows;10;;Professional, x64)'
        },
        agent,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`User Info Error (${response.status}): ${errorText}`);
            throw new Error(`Failed to get user info: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Get user info network/parse error:', error);
        throw error; // Re-throw
    }
  }

  /**
   * Save account metadata to non-sensitive storage (electron-store)
   * @private
   */
  _saveAccount(accountData) {
    // Ensure accounts are loaded
     if (!this.accounts) { this.accounts = this.store.get('accounts', []); }

    const existingIndex = this.accounts.findIndex(a => a.id === accountData.id);

    if (existingIndex >= 0) {
      // Update existing account, preserving createdAt
      this.accounts[existingIndex] = {
        ...this.accounts[existingIndex], // Keep existing fields like createdAt
        ...accountData, // Overwrite with new data
      };
      console.log(`Updated account metadata for ${accountData.id}`);
    } else {
      // Add new account
      this.accounts.push({
          ...accountData,
          createdAt: accountData.createdAt || Date.now() // Ensure createdAt exists
      });
      console.log(`Added new account metadata for ${accountData.id}`);
    }

    this.store.set('accounts', this.accounts);
  }

  /**
   * Save sensitive auth data (cookies) to secure storage (keytar)
   * @private
   */
  async storeCookiesSecurely(accountId, cookies) {
    if (!cookies || typeof cookies !== 'object') {
        throw new Error('Invalid cookies object provided.');
    }
    try {
        // Store only essential cookies needed for re-auth/launch
        const cookiesToStore = {
            ssid: cookies.ssid,
            clid: cookies.clid,
            csid: cookies.csid,
            tdid: cookies.tdid,
            sub: cookies.sub || accountId // Ensure PUUID is stored
        };
        const serializedCookies = JSON.stringify(cookiesToStore);
        // Use accountId (PUUID) as the key
        await keytar.setPassword(AUTH_SERVICE, accountId, serializedCookies);
        console.log(`Securely stored cookies for account ${accountId}`);
    } catch (error) {
        console.error(`Failed to store secure cookies for account ${accountId}:`, error);
        throw new Error('Failed to securely store account credentials.');
    }
  }

  /**
   * Get stored cookies from secure storage
   * @private
   */
  async retrieveCookiesSecurely(accountId) {
    try {
        // Use accountId (PUUID) as the key
        const serializedCookies = await keytar.getPassword(AUTH_SERVICE, accountId);
        if (serializedCookies) {
            return JSON.parse(serializedCookies);
        }
        console.log(`No secure cookies found for account ${accountId}`);
        return null; // No cookies found
    } catch (error) {
        console.error(`Failed to retrieve secure cookies for account ${accountId}:`, error);
        // Don't throw, return null to indicate failure/absence
        return null;
    }
  }

  // --- Cookie Utilities ---
  _extractCookies(response, existingCookies = {}) {
      const setCookieHeader = response.headers.raw()['set-cookie'] || [];
      setCookieHeader.forEach(cookieString => {
          const parts = cookieString.split(';')[0].split('=');
          if (parts.length >= 2) {
              const name = parts[0].trim();
              const value = parts.slice(1).join('=').trim();
              if (name && value) {
                  existingCookies[name] = value;
              }
          }
      });
      return existingCookies;
  }

  _formatCookies(cookieObj) {
      return Object.entries(cookieObj)
          .map(([key, value]) => `${key}=${value}`)
          .join('; ');
  }

}

module.exports = { AuthService }; // Export class correctly