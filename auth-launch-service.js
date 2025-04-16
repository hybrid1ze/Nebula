const fs = require('fs').promises;
const path = require('path');
const yaml = require('yaml');
const { exec, spawn } = require('child_process');
const os = require('os');
const { AuthService } = require('./auth-service'); // To potentially add imported accounts

// Constants for Riot Client paths and filenames
const RIOT_CLIENT_INSTALLS_PATH = path.join(process.env.ProgramData, 'Riot Games', 'RiotClientInstalls.json');
const RIOT_CLIENT_DATA_PATH_BASE = path.join(process.env.LOCALAPPDATA, 'Riot Games');
const RIOT_GAMES_PRIVATE_SETTINGS = 'RiotGamesPrivateSettings.yaml';
const RIOT_CLIENT_SETTINGS = 'RiotClientSettings.yaml';
const RIOT_CLIENT_DATA_FOLDER = 'Riot Client/Data';
const RIOT_CLIENT_CONFIG_FOLDER = 'Riot Client/Config';
const RIOT_CLIENT_BETA_DATA_FOLDER = 'Beta/Data'; // Check Beta path as well
const RIOT_CLIENT_BETA_CONFIG_FOLDER = 'Beta/Config';

class AuthLaunchService {
    constructor(store) {
        this.store = store;
        // Need an instance of AuthService to add imported accounts
        this.authService = new AuthService(store);
    }

    async getRiotClientPath(basePath = null) {
        if (!os.platform().startsWith('win')) {
            throw new Error('Automatic Riot Client detection is only supported on Windows.');
        }

        try {
            const installDataContent = await fs.readFile(RIOT_CLIENT_INSTALLS_PATH, 'utf-8');
            const installData = JSON.parse(installDataContent);

            // Prioritize rc_live, then rc_default, then others
            const pathsToCheck = ['rc_live', 'rc_default', 'rc_beta', 'rc_esports'];
            for (const key of pathsToCheck) {
                if (installData[key] && typeof installData[key] === 'string') {
                    try {
                        await fs.access(installData[key]); // Check if file exists
                        console.log(`Found Riot Client at: ${installData[key]}`);
                        return installData[key];
                    } catch {
                        // File doesn't exist, try next
                    }
                }
            }
            throw new Error('No valid Riot Client executable found in RiotClientInstalls.json.');
        } catch (error) {
            console.error('Error finding Riot Client path:', error);
            throw new Error(`Could not find Riot Client installation. Ensure Riot Games is installed. (${error.message})`);
        }
    }

    async findCurrentRiotDataPaths() {
        const paths = { dataPath: null, configPath: null };

        const defaultDataPath = path.join(RIOT_CLIENT_DATA_PATH_BASE, RIOT_CLIENT_DATA_FOLDER);
        const defaultConfigPath = path.join(RIOT_CLIENT_DATA_PATH_BASE, RIOT_CLIENT_CONFIG_FOLDER);
        const betaDataPath = path.join(RIOT_CLIENT_DATA_PATH_BASE, RIOT_CLIENT_BETA_DATA_FOLDER);
        const betaConfigPath = path.join(RIOT_CLIENT_DATA_PATH_BASE, RIOT_CLIENT_BETA_CONFIG_FOLDER);

        // Prefer Beta if it exists, otherwise use default
        try {
            await fs.access(betaDataPath);
            await fs.access(betaConfigPath);
            paths.dataPath = betaDataPath;
            paths.configPath = betaConfigPath;
            console.log('Using Beta Riot Client data paths.');
            return paths;
        } catch {
            // Beta path doesn't exist or is incomplete, try default
        }

        try {
            await fs.access(defaultDataPath);
            await fs.access(defaultConfigPath);
            paths.dataPath = defaultDataPath;
            paths.configPath = defaultConfigPath;
            console.log('Using Default Riot Client data paths.');
            return paths;
        } catch (error) {
            console.error('Could not find valid Riot Client data/config directories:', error);
            throw new Error('Could not locate Riot Client data directories.');
        }
    }

    async readPrivateSettings(dataPath) {
        const filePath = path.join(dataPath, RIOT_GAMES_PRIVATE_SETTINGS);
        try {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            const parsedYaml = yaml.parse(fileContent);
            return parsedYaml;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`Private settings file not found at ${filePath}. Assuming not logged in.`);
                return null; // File not found is okay, means not logged in
            }
            console.error(`Error reading or parsing ${RIOT_GAMES_PRIVATE_SETTINGS}:`, error);
            throw new Error(`Failed to read Riot private settings: ${error.message}`);
        }
    }

    extractCookiesFromYaml(parsedYaml) {
        try {
            const cookiesArray = parsedYaml?.private?.['riot-login']?.persist?.session?.cookies;
            if (!Array.isArray(cookiesArray)) {
                return null;
            }

            const cookies = {};
            cookiesArray.forEach(cookie => {
                if (cookie.name && cookie.value) {
                    cookies[cookie.name] = cookie.value;
                }
            });

            // Check for essential cookies
            if (cookies.ssid && cookies.sub) {
                return cookies;
            }
            return null;
        } catch (error) {
            console.error('Error extracting cookies from YAML:', error);
            return null;
        }
    }

    async importCurrentAccount() {
        console.log('Attempting to import current Riot account...');
        try {
            const { dataPath } = await this.findCurrentRiotDataPaths();
            const privateSettings = await this.readPrivateSettings(dataPath);

            if (!privateSettings) {
                throw new Error('Could not read Riot private settings. Is the Riot Client running and logged in?');
            }

            const cookies = this.extractCookiesFromYaml(privateSettings);

            if (!cookies || !cookies.ssid || !cookies.sub) {
                throw new Error('Could not extract necessary cookies (ssid, sub) from Riot settings.');
            }

            // TODO: Ideally, fetch username/region using an API call with the cookies/tokens
            // For now, use placeholder data
            const accountData = {
                id: cookies.sub, // PUUID
                username: `Imported (${cookies.sub.substring(0, 5)})`, // Placeholder
                region: 'NA', // Placeholder
                cookies: cookies
            };

            const addedAccount = await this.authService.addImportedAccount(accountData);
            console.log('Successfully imported account:', addedAccount?.id);
            return addedAccount;

        } catch (error) {
            console.error('Failed to import current account:', error);
            throw error; // Re-throw the error to be handled by the main process
        }
    }


    createPrivateSettingsYaml(cookies) {
        // Construct the YAML structure expected by Riot Client
        const yamlStructure = {
            private: {
                'riot-login': {
                    persist: {
                        session: {
                            cookies: [
                                // Order might matter, try to match observed files
                                { domain: 'auth.riotgames.com', hostOnly: true, httpOnly: true, name: 'tdid', path: '/', persistent: true, secureOnly: true, value: cookies.tdid || '' },
                                { domain: 'auth.riotgames.com', hostOnly: true, httpOnly: true, name: 'ssid', path: '/', persistent: true, secureOnly: true, value: cookies.ssid },
                                { domain: 'auth.riotgames.com', hostOnly: true, httpOnly: true, name: 'clid', path: '/', persistent: true, secureOnly: true, value: cookies.clid || '' },
                                { domain: 'auth.riotgames.com', hostOnly: true, httpOnly: false, name: 'sub', path: '/', persistent: true, secureOnly: true, value: cookies.sub },
                                { domain: 'auth.riotgames.com', hostOnly: true, httpOnly: true, name: 'csid', path: '/', persistent: true, secureOnly: true, value: cookies.csid || '' },
                                // Add other cookies if necessary (e.g., PVPNET)
                            ]
                        }
                    }
                }
            }
        };
        return yaml.stringify(yamlStructure);
    }

    createClientSettingsYaml(region = 'NA', locale = 'en_US') {
        // Basic client settings structure
         const yamlStructure = {
            install: {
                globals: {
                    region: region.toUpperCase(), // Ensure region is uppercase
                    locale: locale,
                }
            },
            patchlines: { // Add patchlines section if needed
                valorant: "live" // Or determine dynamically
            }
            // Add other necessary settings if required
        };
        return yaml.stringify(yamlStructure);
    }

    async closeRiotProcesses() {
        console.log('Closing Riot and Valorant processes...');
        const processesToKill = ['RiotClientServices.exe', 'VALORANT-Win64-Shipping.exe', 'RiotClientUx.exe', 'RiotClientUxRender.exe']; // Add Ux processes
        const platform = os.platform();

        try {
            if (platform === 'win32') {
                const command = `taskkill /F ${processesToKill.map(p => `/IM ${p}`).join(' ')} /T`;
                await new Promise((resolve, reject) => {
                    exec(command, (error, stdout, stderr) => {
                        // taskkill might return error code 128 if process not found, which is okay
                        if (error && !stderr.includes('ERROR: The process') && !stderr.includes('not found')) {
                            console.warn(`Error during taskkill: ${stderr || error.message}`);
                            // Don't reject, just log warning, as some processes might not be running
                        }
                        console.log(`Taskkill output: ${stdout}`);
                        resolve();
                    });
                });
            } else if (platform === 'darwin') { // macOS
                const command = `pkill -f ${processesToKill.join('|')}`; // Adjust command for macOS if needed
                 await new Promise((resolve, reject) => {
                    exec(command, (error, stdout, stderr) => {
                        if (error && error.code !== 1) { // pkill exits 1 if no process found
                             console.warn(`Error during pkill: ${stderr || error.message}`);
                        }
                         console.log(`pkill output: ${stdout}`);
                        resolve();
                    });
                });
            } else {
                console.warn('Process closing not implemented for this platform:', platform);
            }
            console.log('Finished attempting to close processes.');
            await new Promise(resolve => setTimeout(resolve, 1500)); // Wait a bit for processes to fully terminate
        } catch (error) {
            console.error('Error closing Riot processes:', error);
            // Don't necessarily stop the launch, but log the error
        }
    }

     async isValorantRunning() {
        const platform = os.platform();
        const valorantProcessName = 'VALORANT-Win64-Shipping.exe'; // Windows specific

        return new Promise((resolve, reject) => {
            let command;
            if (platform === 'win32') {
                command = `tasklist /FI "IMAGENAME eq ${valorantProcessName}"`;
            } else if (platform === 'darwin') {
                command = `pgrep -f ${valorantProcessName}`; // Adjust for macOS if needed
            } else {
                return resolve(false); // Unsupported platform
            }

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    // Command error likely means process not found on Windows
                    if (platform === 'win32' && error.code === 1) return resolve(false);
                    // pgrep error might mean not found on macOS
                    if (platform === 'darwin' && error.code === 1) return resolve(false);
                    console.error(`Error checking process: ${stderr || error.message}`);
                    return resolve(false); // Assume not running on error
                }

                if (platform === 'win32') {
                    resolve(stdout.toLowerCase().includes(valorantProcessName.toLowerCase()));
                } else if (platform === 'darwin') {
                    resolve(stdout.trim().length > 0);
                } else {
                    resolve(false);
                }
            });
        });
    }


    async launchValorant(account) {
        if (!account || !account.id) {
            throw new Error('Invalid account data provided for launch.');
        }

        console.log(`Launching Valorant for account: ${account.username || account.id}`);

        // 1. Retrieve secure cookies
        const cookies = await this.authService.retrieveCookiesSecurely(account.id);
        if (!cookies || !cookies.ssid || !cookies.sub) {
            throw new Error('Failed to retrieve necessary cookies (ssid, sub) for the account.');
        }

        // 2. Close existing processes
        await this.closeRiotProcesses();

        // 3. Find Riot Client Path and Data Paths
        const riotClientExePath = await this.getRiotClientPath();
        const { dataPath, configPath } = await this.findCurrentRiotDataPaths();

        // 4. Create/Overwrite Auth Files
        try {
            // Ensure directories exist
            await fs.mkdir(dataPath, { recursive: true });
            await fs.mkdir(configPath, { recursive: true });

            // Write private settings (cookies)
            const privateSettingsContent = this.createPrivateSettingsYaml(cookies);
            await fs.writeFile(path.join(dataPath, RIOT_GAMES_PRIVATE_SETTINGS), privateSettingsContent, 'utf-8');
            console.log(`Wrote ${RIOT_GAMES_PRIVATE_SETTINGS}`);

            // Write client settings (region)
            const clientSettingsContent = this.createClientSettingsYaml(account.region);
            await fs.writeFile(path.join(configPath, RIOT_CLIENT_SETTINGS), clientSettingsContent, 'utf-8');
            console.log(`Wrote ${RIOT_CLIENT_SETTINGS}`);

        } catch (error) {
            console.error('Error writing Riot configuration files:', error);
            throw new Error(`Failed to write Riot configuration files: ${error.message}`);
        }

        // 5. Launch Riot Client
        try {
            const args = ['--launch-product=valorant', '--launch-patchline=live'];
            console.log(`Launching Riot Client: ${riotClientExePath} with args: ${args.join(' ')}`);

            // Use spawn for better process control, detach it
            const child = spawn(riotClientExePath, args, {
                detached: true,
                stdio: 'ignore' // Ignore stdin/stdout/stderr
            });
            child.unref(); // Allow parent process to exit independently

            console.log('Riot Client launch command issued.');
            // Don't wait for the process to exit here
            // The main process will monitor for Valorant starting

        } catch (error) {
            console.error('Error spawning Riot Client process:', error);
            throw new Error(`Failed to launch Riot Client: ${error.message}`);
        }
    }
}

// Export class and helper functions if needed externally
module.exports = {
    AuthLaunchService,
    getRiotClientPath: AuthLaunchService.prototype.getRiotClientPath, // Expose helper if needed
    closeRiotProcesses: AuthLaunchService.prototype.closeRiotProcesses,
    isValorantRunning: AuthLaunchService.prototype.isValorantRunning
};