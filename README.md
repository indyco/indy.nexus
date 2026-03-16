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

# Start the server (default: http://localhost:3000)
npm start

# Development mode (auto-restart on file changes)
npm run dev
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | HTTP port to listen on |
| `SESSION_SECRET` | *(dev default)* | Session signing secret — **change in production** |
| `NODE_ENV` | `development` | Set to `production` to enable secure (HTTPS-only) session cookie |

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

Use the `≡` action button on a server row to open that server's console panel.

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

## Project Structure

```
indy.nexus/
├── server.js          # Express server + REST API
├── package.json
├── data/
│   └── users.json     # Runtime user store (gitignored)
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
