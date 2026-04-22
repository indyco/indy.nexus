# indy.nexus

A TUI-styled game server hosting portal — dark-themed, keyboard & mouse navigable, with live system resource monitoring, game server management, and manual admin approval for user access.

## Screenshots

| Landing | Login | Register |
|---------|-------|----------|
| ![Landing](https://github.com/user-attachments/assets/4b542758-7753-4842-8f47-5c932d6dda72) | ![Login](https://github.com/user-attachments/assets/cf24a54c-aa2c-43e4-9a56-8ab4ec3fba2d) | ![Register](https://github.com/user-attachments/assets/b8adf3b7-1aa9-4fee-8915-308c28f81ac3) |

| Admin — Servers | Admin — Resources | Dashboard |
|-----------------|-------------------|-----------|
| ![Admin Servers](https://github.com/user-attachments/assets/9417c00a-4e4b-448a-92f4-646fc2b1adab) | ![Admin Resources](https://github.com/user-attachments/assets/6943d90e-6c64-456f-945c-e3a4117918fb) | ![Dashboard](https://github.com/user-attachments/assets/fbd819ca-76e4-471e-a63b-bfeb588ba351) |

## Setup

```bash
# Install dependencies
npm install

# Start the server in live mode (requires Proxmox env vars — see Configuration)
npm start

# Start the server in test mode with dummy service data (no Proxmox needed)
npm run start:test

# Development mode (auto-restart on file changes)
npm run dev
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | HTTP port to listen on |
| `SESSION_SECRET` | *(required)* | Session signing secret (minimum 32 characters) |
| `NODE_ENV` | `development` | Set to `production` to enable secure (HTTPS-only) session cookie |
| `PROXMOX_HOST` | *(required in live mode)* | Proxmox VE API URL, e.g. `https://192.168.1.100:8006` |
| `PROXMOX_NODE` | *(required in live mode)* | Proxmox node name (e.g. `pve`) |
| `PROXMOX_TOKEN_ID` | *(required in live mode)* | API token ID (e.g. `root@pam!indynexus`) |
| `PROXMOX_TOKEN_SECRET` | *(required in live mode)* | API token secret UUID |

Proxmox variables are **not required** when running in `--test` mode.

### Creating a Proxmox API Token

1. In the Proxmox web UI, go to **Datacenter → Permissions → API Tokens → Add**.
2. Select a user (e.g. `root@pam`), set a Token ID (e.g. `indynexus`), and **uncheck** Privilege Separation.
3. Copy the Token ID (`root@pam!indynexus`) and the Secret UUID — the secret is only shown once.

### Service Configuration (`data/services.json`)

In live mode, the portal reads `data/services.json` to know which Proxmox LXC containers are game servers. Each entry maps a service ID to a Proxmox VMID along with display metadata:

```json
[
  {
    "id": "mc-1",
    "vmid": 101,
    "name": "minecraft-survival",
    "game": "Minecraft",
    "port": 25565,
    "maxPlayers": 20
  }
]
```

An example file is provided at `data/services.json.example`. Copy it and edit the VMIDs to match your Proxmox containers.

## First Login

An **admin** account is bootstrapped automatically on first run:

- **Username:** `admin`
- **Password:** `admin`

> ⚠️ Change the admin password immediately after first login via the Admin Panel → Settings tab.

## Authentication Flow

1. Users visit `/register.html` and submit a registration request.
2. The admin logs in at `/login.html` → redirected to `/admin.html`.
3. Admin approves or denies pending users from the **Pending** tab.
4. Approved users can log in and access the game server dashboard at `/dashboard.html`.

## Admin Panel

The admin panel (`/admin.html`) is the control centre for the entire platform. It has five sections accessible from the sidebar:

### System › Servers
A live table of all game server processes showing **Service**, **Game**, **Status**, **Players**, **PID**, **CPU%**, **RAM**, **Uptime**, and **Port**. Each row has icon buttons to **Start**, **Stop**, **Restart**, or view **More Info** in a slide-out panel.

### System › Resources
Real-time **CPU**, **RAM**, and **GPU** utilisation cards with progress bars, percentage readout, and hardware details (core count, total memory, GPU model). System uptime is shown in the panel header. The title bar also displays compact sparkline gauges for at-a-glance monitoring.

### Users › Pending
Lists users whose registration requests are awaiting review. Approve or deny each request with a single click.

### Users › All Users
Full user list with username, role, status, and registration date. Revoke access for any non-admin user from this view.

### Settings
Change the admin account password and rename any user account.

## User Dashboard

The user dashboard (`/dashboard.html`) shows all game servers with their current status, player count, and port. Users can:

- Filter servers by **All** / **Online** / **Offline**
- **Start** or **Stop** servers
- Open a server-specific **Console** pane from the server row action button
- View their account details under **My Account**

## Keyboard Navigation

### Global (all pages)

| Key | Action |
|-----|--------|
| `Tab` | Move between form fields / UI elements |
| `Enter` | Select focused item |

### Landing page

| Key | Action |
|-----|--------|
| `L` | Go to Login |
| `R` | Go to Register |

### Admin Panel

| Key | Action |
|-----|--------|
| `↑` / `k` | Move up in list |
| `↓` / `j` | Move down in list |
| `1` | Servers tab |
| `2` | Resources tab |
| `3` | Pending Users tab |
| `4` | All Users tab |
| `5` | Settings tab |
| `r` | Refresh data |
| `?` | Toggle keyboard shortcut help |
| `q` | Logout |
| `Esc` | Close dialogs |

Use the `>_` action button on a server row to open that server's console panel. The `≡` menu button provides access to Stop and Restart actions.

### User Dashboard

| Key | Action |
|-----|--------|
| `↑` / `k` | Move up in list |
| `↓` / `j` | Move down in list |
| `1` | Servers tab |
| `2` | Account tab |
| `?` | Toggle keyboard shortcut help |
| `q` | Logout |
| `Esc` | Close dialogs |

## Deployment & Updates

After the initial install via `setup-lxc.sh`, the LXC will keep itself in sync with `origin/main` automatically. A systemd timer (`indy-nexus-update.timer`) fires every 5 minutes and runs `update-lxc.sh`, which:

1. Fetches `origin/main` and compares against the local HEAD.
2. If there are new commits, fast-forwards, re-runs `npm install --production` **only when `package.json` or `package-lock.json` changed**, re-asserts ownership, and restarts `indy-nexus.service`.
3. Uses a lock file (`/run/indy-nexus-update.lock`) to prevent overlapping runs.

So the normal workflow is simply:

```bash
git push origin main
```

Within ~5 minutes the live site reflects the new commit.

### Checking status

```bash
# When the timer last ran and when it'll run next
systemctl status indy-nexus-update.timer
systemctl list-timers indy-nexus-update.timer

# Logs from the most recent update
journalctl -u indy-nexus-update.service -n 50 --no-pager
```

### Triggering an update manually

```bash
# Run the updater once, immediately (no-op if already up to date)
sudo systemctl start indy-nexus-update.service

# Or force a rebuild + restart at the current commit
sudo /opt/indy-nexus/update-lxc.sh --force
```

### Pausing auto-updates

```bash
sudo systemctl disable --now indy-nexus-update.timer   # stop
sudo systemctl enable  --now indy-nexus-update.timer   # resume
```

## Securing auto-updates

The updater can (and should) refuse to fast-forward unless every new commit is signed by a trusted key. This protects the live site from a compromised GitHub account or repo from silently pushing malicious code onto the LXC.

Verification is **opt-in**: a fresh install runs unverified until you populate two config files on the LXC. Existing deployments continue to work unchanged until you opt in.

### One-time developer setup (SSH-signed commits)

On each machine you'll commit from:

1. **Generate (or pick) a signing key.** A dedicated Ed25519 key is recommended:

    ```powershell
    ssh-keygen -t ed25519 -C "indy.nexus signing key" -f "$env:USERPROFILE\.ssh\indy_signing_ed25519"
    ```

2. **Tell git to sign with it, scoped to this repo.** Run these from inside your clone of `indy.nexus`:

    ```bash
    git config --local gpg.format ssh
    git config --local user.signingkey "$HOME/.ssh/indy_signing_ed25519.pub"
    git config --local commit.gpgsign true
    git config --local tag.gpgsign true
    ```

    (On Windows, replace `$HOME` with `$env:USERPROFILE` or the absolute path.)

    These settings live in this repo's `.git/config`, which isn't tracked by git. If you re-clone the repo or work on a second machine, re-run the four commands in the new clone. If you'd rather sign *every* commit from this machine regardless of repo, use `--global` instead of `--local`.

3. **Verify it works.** Make a commit, then:

    ```bash
    git log --show-signature -1
    ```

    You should see a `Good "git" signature` line.

4. **Register the key with GitHub.** In GitHub → Settings → SSH and GPG keys → *New SSH key*, **set the key type to `Signing Key`** (not `Authentication Key`) and paste the contents of `indy_signing_ed25519.pub`. This makes GitHub show your commits as "Verified".

### One-time LXC setup (enforce verification)

On the LXC, as root:

1. **Populate the allowed-signers file** with your public key:

    ```bash
    cp /etc/indy-nexus/allowed_signers.example /etc/indy-nexus/allowed_signers
    nano /etc/indy-nexus/allowed_signers
    ```

    Replace the placeholder with a single line containing your committer email, the key type, and the base64 key body — for example:

    ```
    you@example.com ssh-ed25519 AAAAC3Nza...abc indy.nexus signing key
    ```

2. **Set the anchor SHA.** Back on your dev machine, after you've made your first signed commit on `main`, grab its SHA:

    ```bash
    git log --show-signature origin/main | head -20
    ```

    Then on the LXC:

    ```bash
    cp /etc/default/indy-nexus-update.example /etc/default/indy-nexus-update
    nano /etc/default/indy-nexus-update
    ```

    Ensure `REQUIRE_SIGNED=1` and paste the signed-commit SHA into `ANCHOR_SHA=`.

3. **Test it end-to-end.**

    ```bash
    sudo systemctl start indy-nexus-update.service
    journalctl -u indy-nexus-update.service -n 30 --no-pager
    ```

    Look for `All post-anchor commits verified.` — that's the happy path.

From this point on, any unsigned commit (or one signed by a key not in `allowed_signers`) will cause the updater to log a clear error and leave the site on the previous good SHA.

### Rolling the signing key

When adding a second machine, or rotating the key:

- Append the new public key as another line in `/etc/indy-nexus/allowed_signers` (one per line).
- Removing a compromised key is just deleting its line; the next updater run will refuse any commit signed only by it.

### Emergency bypass

If you ever need to push past a bad verification state (e.g. you lost the signing key mid-incident), you can run the updater once with verification disabled:

```bash
sudo /opt/indy-nexus/update-lxc.sh --insecure-skip-verify
```

The timer itself still enforces verification; the flag only affects the one manual invocation. A warning is logged to `journalctl` on every such run.

### Future (Tier 2): trusting cloud Oz agents

Cloud Oz agents push via the `oz-agent` GitHub user, whose commits are "Verified" by GitHub's own signing infrastructure rather than by a key you hold locally. When/if you start using cloud Oz against this repo, we'll add a second code path to `update-lxc.sh` that calls the GitHub API and accepts commits whose author login is `oz-agent` *and* whose `verification.verified` is true. Until then, this repo is signed-by-you-only.

## Project Structure

```
indy.nexus/
├── server.js          # Express server + REST API
├── proxmox.js         # Proxmox VE REST API client
├── package.json
├── setup-lxc.sh       # One-shot installer for a fresh Debian 12 LXC
├── update-lxc.sh      # Idempotent pull + restart (invoked by timer)
├── systemd/
│   ├── indy-nexus-update.service      # Oneshot unit that runs update-lxc.sh
│   ├── indy-nexus-update.timer        # Every-5-minutes trigger
│   ├── indy-nexus-update.env.example  # Template for /etc/default/indy-nexus-update
│   └── allowed_signers.example        # Template for /etc/indy-nexus/allowed_signers
├── data/
│   ├── users.json     # Runtime user store (gitignored)
│   ├── services.json  # Service → Proxmox VMID mapping (create from .example)
│   └── services.json.example
└── public/
    ├── index.html     # Landing page
    ├── login.html     # Login page
    ├── register.html  # Registration / request-access page
    ├── dashboard.html # User dashboard (game servers)
    ├── admin.html     # Admin panel (servers, resources, users, settings)
    ├── css/
    │   └── tui.css    # Catppuccin Mocha TUI theme
    └── js/
        └── tui.js     # Navigation helpers & API utilities
```

## Design

Built with the **Catppuccin Mocha** colour palette — a modern dark theme widely used in TUI environments. Base background is `#1e1e2e` (deep purple-blue, not pure black).
