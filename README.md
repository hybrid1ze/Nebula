# Nebula - Valorant Account Manager

Nebula is an Electron-based desktop application designed to help you easily manage and switch between multiple Valorant accounts without repeatedly entering login credentials.

**Disclaimer:** Nebula interacts with Riot Games' internal APIs and client mechanisms which are unofficial and subject to change. Use this application at your own risk. It was created under Riot Games' "Legal Jibber Jabber" policy using assets potentially owned by Riot Games. Riot Games does not endorse or sponsor this project.

## Features

*   **Multiple Account Management:** Store credentials securely for multiple Valorant accounts.
*   **Quick Launch:** Launch Valorant directly logged into a selected account.
*   **Import Existing Session:** Easily import accounts you are already logged into via the official Riot Client.
*   **Secure Storage:** Uses the operating system's secure credential storage (`keytar`) for sensitive data like authentication cookies.
*   **Region Support:** Stores region information for accounts.
*   **Theme Options:** Supports Light, Dark, and System default themes.

## How it Works

Nebula securely stores authentication cookies (primarily the `ssid` cookie) obtained either through direct login (experimental) or by importing from an active Riot Client session.

When you launch an account:
1.  Nebula retrieves the stored cookies for that account.
2.  It closes any running Riot/Valorant processes.
3.  It creates temporary configuration files (`RiotGamesPrivateSettings.yaml`, `RiotClientSettings.yaml`) within the Riot Client's local data directory, embedding the selected account's cookies.
4.  It starts the official Riot Client, which reads these configuration files and launches Valorant pre-authenticated for the selected account.

## Installation

**Option 1: From Releases (Recommended for most users)**

1.  Go to the [Releases page](https://github.com/hybrid1ze/Nebula/releases) of the Nebula GitHub repository.
2.  Download the latest installer for your operating system (`.exe` for Windows, `.dmg` for macOS, `.AppImage` or `.deb` for Linux).
3.  Run the installer and follow the on-screen instructions.

**Option 2: From Source (For developers)**

1.  **Prerequisites:**
    *   [Node.js](https://nodejs.org/) (includes npm)
    *   [Git](https://git-scm.com/)
2.  **Clone the repository:**
    ```bash
    git clone https://github.com/hybrid1ze/Nebula.git
    cd Nebula
    ```
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Run the application:**
    ```bash
    npm start
    ```

## Usage

1.  **Run Nebula.**
2.  **Set Riot Games Path:**
    *   Click the settings icon (⚙️).
    *   Click "Browse..." and navigate to your main Riot Games installation directory (e.g., `C:\Riot Games`).
    *   Click "Save Settings". This is crucial for launching to work.
3.  **Add Accounts:**
    *   **Import (Recommended):** Log into Valorant using the official Riot Client. Then, in Nebula, click "Import Current". The currently logged-in account will be added.
    *   **Username/Password (Experimental):** Use the "Add New Account" form. *Note: This method directly interacts with Riot's APIs and may be unstable or require MFA handling not fully implemented in the UI yet.*
4.  **Launch Valorant:**
    *   Select an account from the list.
    *   Click the "Launch" button. Nebula will handle the authentication and start Valorant.
5.  **Manage Accounts:**
    *   Use the "Remove" button to delete accounts.

## Building the Application

To create distributable installers/packages:

```bash
npm run build
```

This command uses `electron-builder` (configured in `package.json`) to create installers in the `dist/` directory.

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## License

[MIT License](LICENSE) (You would need to add a LICENSE file, typically MIT for open source projects like this)