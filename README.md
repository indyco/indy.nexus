# indy.nexus

A TUI-styled game server hosting portal — dark-themed, keyboard & mouse navigable, with manual admin approval for user access.

## Screenshots

| Landing | Login | Admin Panel | Dashboard |
|---------|-------|-------------|-----------|
| ![Landing](https://github.com/user-attachments/assets/287003db-6645-4044-b059-740cfa8e3ce5) | ![Login](https://github.com/user-attachments/assets/5c20a76b-dfd0-474f-9f15-df9484ad4e42) | ![Admin](https://github.com/user-attachments/assets/e418d53d-1dc9-483a-813a-c85874f4b091) | ![Dashboard](https://github.com/user-attachments/assets/ec9d24dd-4976-4028-87eb-c3af9d10fb2c) |

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
4. Approved users can log in and access the game server dashboard.

## Keyboard Navigation

| Key | Action |
|-----|--------|
| `↑` / `k` | Move up in lists |
| `↓` / `j` | Move down in lists |
| `Tab` | Move between form fields / UI elements |
| `Enter` | Select focused item |
| `Esc` | Close dialogs / go back |
| `?` | Toggle keyboard shortcut help |
| `1` / `2` / `3` | Switch tabs (dashboard / admin) |
| `q` | Logout (dashboard / admin) |
| `L` | Go to Login (landing page) |
| `R` | Go to Register (landing page) |

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
    ├── register.html  # Registration page
    ├── dashboard.html # User dashboard (game servers)
    ├── admin.html     # Admin panel (user approvals)
    ├── css/
    │   └── tui.css    # Catppuccin Mocha TUI theme
    └── js/
        └── tui.js     # Navigation helpers & API utilities
```

## Design

Built with the **Catppuccin Mocha** colour palette — a modern dark theme widely used in TUI environments. Base background is `#1e1e2e` (deep purple-blue, not pure black).
