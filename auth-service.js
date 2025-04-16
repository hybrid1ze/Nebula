const fetch = require('node-fetch');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const keytar = require('keytar');
const crypto = require('crypto');
const { spawn } = require('child_process');
const https = require('https');

// Constants
const AUTH_SERVICE = 'NebulaAccountManager'; // Use project name for service ID
const COOKIE_KEYS = ['ssid', 'clid', 'csid', 'tdid']; // Primarily interested in these cookies
const AUTH_ENDPOINTS = {
  AUTHORIZE: 'https://auth.riotgames.com/authorize',
  // TOKEN: 'https://auth.riotgames.com/token', // Typically not used directly in this flow
  ENTITLEMENTS: 'https://entitlements.auth.riotgames.com/api/token/v1',
  USERINFO: 'https://auth.riotgames.com/userinfo',
  AUTH: 'https://auth.riotgames.com/api/v1/authorization',
};

// Mimics platform data sent by Riot Client; may need updates if Riot changes checks.
const CLIENT_PLATFORM = Buffer.from(JSON.stringify({
  "platformType": "PC",
  "platformOS": "Windows",
  "platformOSVersion": "10.0.19042.1.256.64bit", // Example, ideally fetch dynamically if possible
  "platformChipset": "Unknown"
})).toString('base64');

class AuthService {
  constructor(store) {
    this.store = store;
    this.accounts = this.store.get('accounts', []);
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
        return authResult; // Propagate MFA requirement or error
      }

      const entitlements = await this._getEntitlements(authResult.accessToken);
      const userInfo = await this._getUserInfo(authResult.accessToken);

      const accountData = {
        id: userInfo.sub, // PUUID is the unique ID
        username: username, // Keep original username for reference/keytar key
        region: region,
        puuid: userInfo.sub,
        displayName: userInfo.acct ? `${userInfo.acct.game_name}#${userInfo.acct.tag_line}` : username,
        lastUsed: Date.now(),
        createdAt: Date.now()
      };

      this._saveAccount(accountData); // Save metadata

      // Store essential cookies securely using PUUID (id) as the key
      await this.storeCookiesSecurely(accountData.id, {
        ssid: authResult.ssid,
        clid: authResult.clid || '',
        csid: authResult.csid || '',
        tdid: authResult.tdid || '',
        sub: accountData.id // Ensure PUUID is stored with cookies
        // Storing access/id tokens is less critical as they expire; cookies are key for re-auth/launch
      });

      return {
        success: true,
        account: { ...accountData } // Return metadata
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
     // IMPORTANT: The initial auth attempt (_performDirectAuth) that returned 'needsMfa'
     // must have provided the necessary sessionCookies to the caller (UI layer).
     // The caller then needs to pass those cookies back into this submitMfa function.
     // This example assumes `sessionCookies` are passed in somehow.
     // TODO: Modify function signature and UI interaction to handle passing cookie state.
     let sessionCookies = {}; // Placeholder: Replace with actual passed-in cookies
     console.warn("MFA submission requires cookie state from initial attempt - using placeholder.");

    try {
      // Pass the required cookies to the MFA completion logic
      const authResult = await this._completeMfaAuth(code, sessionCookies);

      if (!authResult.success) {
        return authResult;
      }

      const entitlements = await this._getEntitlements(authResult.accessToken);
      const userInfo = await this._getUserInfo(authResult.accessToken);

      const accountData = {
        id: userInfo.sub, // PUUID
        username: username,
        region: region,
        puuid: userInfo.sub,
        displayName: userInfo.acct ? `${userInfo.acct.game_name}#${userInfo.acct.tag_line}` : username,
        lastUsed: Date.now(),
        createdAt: Date.now() // Consider updating existing instead of always setting new
      };

      this._saveAccount(accountData);

      // Store cookies securely using PUUID (id)
      await this.storeCookiesSecurely(accountData.id, {
        ssid: authResult.ssid,
        clid: authResult.clid || '',
        csid: authResult.csid || '',
        tdid: authResult.tdid || '',
        sub: accountData.id
        // access/id tokens less critical to store long-term
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
      const cookies = await this.retrieveCookiesSecurely(accountId);
      if (!cookies || !cookies.ssid) {
        throw new Error('No stored SSID cookie found for re-authentication.');
      }

      const authResult = await this._performSSIDAuth(
        cookies.ssid,
        cookies.clid,
        cookies.csid,
        cookies.tdid
      );

      if (!authResult.success) {
           throw new Error(authResult.message || 'SSID re-authentication failed.');
      }

      const entitlements = await this._getEntitlements(authResult.accessToken);

      // Re-store cookies securely in case they were refreshed during SSID auth
      await this.storeCookiesSecurely(accountId, {
          ssid: authResult.ssid,
          clid: authResult.clid || '',
          csid: authResult.csid || '',
          tdid: authResult.tdid || '',
          sub: accountId
      });

      this.updateLastUsed(accountId); // Update metadata

      return {
        success: true,
        accessToken: authResult.accessToken,
        idToken: authResult.idToken,
        entitlementsToken: entitlements.entitlements_token,
        cookies: { // Return the latest cookies
            ssid: authResult.ssid,
            clid: authResult.clid || '',
            csid: authResult.csid,
            tdid: authResult.tdid,
            sub: accountId
        }
      };
    } catch (error) {
      console.error(`Token refresh error for ${accountId}:`, error);
      // Indicate failure, UI should prompt for re-login if needed
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
    if (!this.accounts) { this.accounts = this.store.get('accounts', []); }
    // Return copies of account metadata
    return this.accounts.map(acc => ({ ...acc }));
  }

  getAccountById(accountId) {
    if (!this.accounts) { this.accounts = this.store.get('accounts', []); }
    const account = this.accounts.find(acc => acc.id === accountId);
    return account ? { ...account } : null; // Return a copy or null
  }


  /**
   * Delete an account
   * @param {string} accountId - Account ID (PUUID) to delete
   */
  async removeAccount(accountId) {
    if (!this.accounts) { this.accounts = this.store.get('accounts', []); }
    this.accounts = this.accounts.filter(account => account.id !== accountId);
    this.store.set('accounts', this.accounts);

    // Remove associated cookies from secure storage
    try {
        await keytar.deletePassword(AUTH_SERVICE, accountId); // Use PUUID as key
        console.log(`Secure cookies deleted for account ${accountId}`);
    } catch (error) {
        console.error(`Failed to delete secure data for account ${accountId}:`, error);
        // Log error but continue, account metadata is removed
    }

    return { success: true };
  }

   async updateLastUsed(accountId) {
        if (!this.accounts) { this.accounts = this.store.get('accounts', []); }
        const accountIndex = this.accounts.findIndex(acc => acc.id === accountId);
        if (accountIndex > -1) {
            this.accounts[accountIndex].lastUsed = Date.now();
            this.store.set('accounts', this.accounts);
        }
    }

  // --- Private Helper Methods ---

  /**
   * Perform direct authentication with username/password
   * @private
   */
  async _performDirectAuth(username, password) {
    let sessionCookies = {}; // Object to hold cookies during the auth flow

    try {
      // WARNING: Bypassing SSL verification is insecure. Use only if necessary and understand the risks.
      const agent = new https.Agent({ rejectUnauthorized: false });

      // 1. Initial POST to /authorization to start the flow and get initial cookies
      const initialRes = await fetch(AUTH_ENDPOINTS.AUTH, {
        method: 'POST',
        agent,
        headers: { 'Content-Type': 'application/json' /* Add User-Agent if needed */ },
        body: JSON.stringify({
          client_id: "play-valorant-web-prod",
          nonce: "1",
          redirect_uri: "https://playvalorant.com/opt_in",
          response_type: "token id_token",
          scope: "account openid"
        })
      });
      sessionCookies = this._extractCookies(initialRes, sessionCookies);

      // 2. PUT credentials to /authorization
      const credsRes = await fetch(AUTH_ENDPOINTS.AUTH, {
        method: 'PUT',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Cookie': this._formatCookies(sessionCookies) // Send back cookies from previous step
          /* Add User-Agent if needed */
        },
        body: JSON.stringify({
          type: "auth",
          username: username,
          password: password,
          remember: true
        })
      });
      sessionCookies = this._extractCookies(credsRes, sessionCookies); // Get new cookies (like ssid)
      const credsData = await credsRes.json();

      // 3. Handle response: Check for MFA, errors, or success
      if (credsData.type === 'multifactor') {
        console.log('MFA Required for', username);
        // The caller needs these cookies to proceed with the MFA step
        return { success: false, needsMfa: true, cookies: sessionCookies, message: 'MFA required' };
      }

      if (credsData.error) {
        console.error('Riot Auth Error:', credsData.error, credsData.error_description);
        return { success: false, error: credsData.error, message: credsData.error_description || 'Authentication failed' };
      }

      if (credsData.type === 'response' && credsData.response?.parameters?.uri) {
        // Success - extract tokens from the redirect URI
        const uri = credsData.response.parameters.uri;
        const params = new URLSearchParams(uri.split('#')[1]);
        const accessToken = params.get('access_token');
        const idToken = params.get('id_token');

        if (!accessToken || !idToken) {
          return { success: false, error: 'missing_tokens', message: 'Tokens not found in response URI' };
        }

        return {
          success: true,
          accessToken,
          idToken,
          ssid: sessionCookies.ssid || '', // Ensure essential cookies are included
          clid: sessionCookies.clid || '',
          csid: sessionCookies.csid || '',
          tdid: sessionCookies.tdid || ''
        };
      }

      // Fallback for unexpected response
      console.error('Unexpected Riot auth response:', credsData);
      return { success: false, error: 'invalid_response', message: 'Unexpected authentication response' };

    } catch (error) {
      console.error('Direct auth request failed:', error);
      return { success: false, error: 'network_error', message: error.message };
    }
  }

  /**
   * Complete MFA authentication
   * @private
   * @param {string} code The MFA code entered by the user.
   * @param {object} sessionCookies Cookies obtained from the initial auth step that required MFA.
   */
  async _completeMfaAuth(code, sessionCookies) {
    if (!sessionCookies || !Object.keys(sessionCookies).length) {
      console.error("MFA completion requires session cookies from the initial auth attempt.");
      return { success: false, error: "mfa_state_missing", message: "MFA session state lost." };
    }

    try {
      const agent = new https.Agent({ rejectUnauthorized: false });

      // PUT MFA code to /authorization endpoint
      const mfaRes = await fetch(AUTH_ENDPOINTS.AUTH, {
        method: 'PUT',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Cookie': this._formatCookies(sessionCookies) // Send cookies from previous step
           /* Add User-Agent if needed */
        },
        body: JSON.stringify({
          type: "multifactor",
          code: code,
          rememberDevice: true
        })
      });

      sessionCookies = this._extractCookies(mfaRes, sessionCookies); // Update cookies again
      const mfaData = await mfaRes.json();

      // Handle response: Check for errors or success
      if (mfaData.error) {
        console.error('Riot MFA Error:', mfaData.error, mfaData.error_description);
        return { success: false, error: mfaData.error, message: mfaData.error_description || 'MFA failed' };
      }

      if (mfaData.type === 'response' && mfaData.response?.parameters?.uri) {
        // Success - extract tokens
        const uri = mfaData.response.parameters.uri;
        const params = new URLSearchParams(uri.split('#')[1]);
        const accessToken = params.get('access_token');
        const idToken = params.get('id_token');

        if (!accessToken || !idToken) {
          return { success: false, error: 'missing_tokens', message: 'Tokens not found in MFA response URI' };
        }

        return {
          success: true,
          accessToken,
          idToken,
          ssid: sessionCookies.ssid || '', // Ensure essential cookies are included
          clid: sessionCookies.clid || '',
          csid: sessionCookies.csid || '',
          tdid: sessionCookies.tdid || ''
        };
      }

      // Fallback for unexpected response
      console.error('Unexpected Riot MFA response:', mfaData);
      return { success: false, error: 'invalid_response', message: 'Unexpected MFA response' };

    } catch (error) {
      console.error('MFA completion request failed:', error);
      return { success: false, error: 'network_error', message: error.message };
    }
  }

  /**
   * Authenticate using stored SSID cookie
   * @private
   */
  async _performSSIDAuth(ssid, clid, csid, tdid) {
    const cookieMap = new Map();
    // Only include cookies if they have a value
    if (ssid) cookieMap.set('ssid', ssid);
    if (clid) cookieMap.set('clid', clid);
    if (csid) cookieMap.set('csid', csid);
    if (tdid) cookieMap.set('tdid', tdid);

    if (!cookieMap.has('ssid')) {
      return { success: false, message: "SSID cookie is required for re-authentication." };
    }

    const cookieHeader = this._formatCookies(Object.fromEntries(cookieMap));

    try {
      const agent = new https.Agent({ rejectUnauthorized: false });
      const authorizeUrl = `${AUTH_ENDPOINTS.AUTHORIZE}?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid`;

      // GET request to /authorize with existing cookies
      const response = await fetch(authorizeUrl, {
        method: 'GET',
        agent,
        headers: { 'Cookie': cookieHeader /* Add User-Agent if needed */ },
        redirect: 'manual' // IMPORTANT: Capture the redirect URL
      });

      const redirectUrl = response.headers.get('location');

      // Check if redirect occurred and contains tokens
      if (response.status >= 300 && response.status < 400 && redirectUrl && redirectUrl.includes('access_token')) {
        const uriFragment = redirectUrl.split('#')[1];
        const params = new URLSearchParams(uriFragment);
        const accessToken = params.get('access_token');
        const idToken = params.get('id_token');

        if (!accessToken || !idToken) {
          return { success: false, message: 'Tokens not found in SSID auth redirect.', needsRelogin: true };
        }

        // Also extract any cookies set in the redirect response headers
        const latestCookies = this._extractCookies(response, Object.fromEntries(cookieMap));

        return {
          success: true,
          accessToken,
          idToken,
          ssid: latestCookies.ssid || ssid, // Prioritize new cookies if set
          clid: latestCookies.clid || clid,
          csid: latestCookies.csid || csid,
          tdid: latestCookies.tdid || tdid,
        };
      }

      // Handle cases where SSID is invalid/expired (no successful redirect)
      console.error(`SSID Auth failed: Status ${response.status}, Redirect: ${redirectUrl}`);
      return { success: false, message: 'SSID authentication failed (cookie likely invalid/expired).', needsRelogin: true };

    } catch (error) {
      console.error('SSID auth request failed:', error);
      return { success: false, error: 'network_error', message: error.message, needsRelogin: true };
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
          agent,
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
             /* Add User-Agent if needed */
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Entitlements Error (${response.status}): ${errorText}`);
          throw new Error(`Failed to get entitlements: ${response.status}`); // Throw for caller to handle
        }
        return await response.json();
    } catch (error) {
        console.error('Get entitlements request failed:', error);
        throw error; // Re-throw
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
          agent,
          headers: {
            'Authorization': `Bearer ${accessToken}`
             /* Add User-Agent if needed */
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`User Info Error (${response.status}): ${errorText}`);
          throw new Error(`Failed to get user info: ${response.status}`); // Throw for caller
        }
        return await response.json();
    } catch (error) {
        console.error('Get user info request failed:', error);
        throw error; // Re-throw
    }
  }

  /**
   * Save account metadata to non-sensitive storage (electron-store)
   * @private
   */
  _saveAccount(accountData) {
    if (!this.accounts) { this.accounts = this.store.get('accounts', []); }

    const existingIndex = this.accounts.findIndex(a => a.id === accountData.id);

    if (existingIndex >= 0) {
      // Update existing account metadata, ensure 'createdAt' is preserved
      this.accounts[existingIndex] = {
        ...this.accounts[existingIndex],
        ...accountData, // Overwrite with potentially new display name, region, lastUsed
      };
    } else {
      // Add new account metadata
      this.accounts.push({
        ...accountData,
        createdAt: accountData.createdAt || Date.now() // Set createdAt if new
      });
    }
    this.store.set('accounts', this.accounts); // Persist changes
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
        // Store only essential cookies needed for re-auth/launch via Riot Client files
        const cookiesToStore = {
            ssid: cookies.ssid,
            clid: cookies.clid, // May be needed in some regions/setups
            csid: cookies.csid, // May be needed in some regions/setups
            tdid: cookies.tdid, // May be needed in some regions/setups
            sub: cookies.sub || accountId // Ensure PUUID (account ID) is stored
        };
        const serializedData = JSON.stringify(cookiesToStore);
        await keytar.setPassword(AUTH_SERVICE, accountId, serializedData); // Use PUUID as key
        console.log(`Stored secure cookies for account ${accountId}`);
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
        const serializedData = await keytar.getPassword(AUTH_SERVICE, accountId); // Use PUUID as key
        if (serializedData) {
            return JSON.parse(serializedData);
        }
        return null; // Return null if not found
    } catch (error) {
        console.error(`Failed to retrieve secure cookies for ${accountId}:`, error);
        return null; // Return null on error
    }
  }

  // --- Private Cookie Utilities ---

  // Extracts cookies from a fetch Response object's 'set-cookie' headers
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

  // Formats a cookie object into a string suitable for a 'Cookie' request header
  _formatCookies(cookieObj) {
      return Object.entries(cookieObj)
          .map(([key, value]) => `${key}=${value}`)
          .join('; ');
  }

}

module.exports = { AuthService };