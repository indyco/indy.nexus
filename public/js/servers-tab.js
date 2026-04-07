"use strict";

(function () {
  const DEFAULT_GAME_ICONS = {
    Minecraft: "⛏",
    Valheim: "⚔",
    CS2: "🎯",
    ARK: "🦕",
    default: "🖥",
  };
  const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/i;
  const KNOWN_STATUSES = new Set(["running", "stopped", "starting"]);

  function normalizeServiceStatus(status) {
    const value = String(status || "").toLowerCase();
    return KNOWN_STATUSES.has(value) ? value : "unknown";
  }

  function normalizeServiceId(id) {
    const value = String(id || "").trim();
    return SERVICE_ID_PATTERN.test(value) ? value : "";
  }

  function toSafeInteger(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.trunc(num) : fallback;
  }

  function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function showServerInfo(service, gameIcons) {
    let panel = document.getElementById("server-info-sidebar");
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = "server-info-sidebar";
      panel.className = "info-sidebar";
      panel.setAttribute("role", "complementary");
      panel.setAttribute("aria-label", "Server details");
      document.body.appendChild(panel);
    }

    const status = normalizeServiceStatus(service?.status);
    const safeName = String(service?.name || "Unknown server");
    const safeGame = String(service?.game || "Unknown");
    const players = Math.max(0, toSafeInteger(service?.players, 0));
    const maxPlayers = Math.max(0, toSafeInteger(service?.maxPlayers, 0));
    const port = Math.max(0, toSafeInteger(service?.port, 0));
    const pid = service?.pid == null ? null : toSafeInteger(service?.pid, 0);
    const cpuPercent = Math.max(0, Math.min(100, toSafeInteger(service?.cpuPercent, 0)));
    const ramMb = Math.max(0, toSafeInteger(service?.ramMb, 0));
    const uptimeSec = Math.max(0, toSafeInteger(service?.uptimeSec, 0));
    const statusLabel = {
      running: `<span style="color:var(--green)">● running</span>`,
      stopped: `<span style="color:var(--overlay0)">● stopped</span>`,
      starting: `<span style="color:var(--blue)">● starting</span>`,
    }[status] || `<span style="color:var(--overlay0)">● ${escapeHtml(status)}</span>`;

    panel.innerHTML = `
      <div class="info-sidebar__header">
        <span class="info-sidebar__title">ℹ ${escapeHtml(safeName)}</span>
        <button class="info-sidebar__close" id="info-sidebar-close" aria-label="Close">✕</button>
      </div>
      <div class="info-sidebar__body">
        <dl class="info-grid">
          <dt>Game</dt>      <dd>${gameIcons[safeGame] || gameIcons.default} ${escapeHtml(safeGame)}</dd>
          <dt>Status</dt>    <dd>${statusLabel}</dd>
          <dt>Players</dt>   <dd>${status === "stopped" ? "—" : `${players} / ${maxPlayers}`}</dd>
          <dt>Port</dt>      <dd>${port}</dd>
          <dt>PID</dt>       <dd>${pid ?? "—"}</dd>
          <dt>CPU</dt>       <dd>${status === "stopped" ? "—" : `${cpuPercent}%`}</dd>
          <dt>RAM</dt>       <dd>${status === "stopped" ? "—" : `${ramMb} MB`}</dd>
          <dt>Uptime</dt>    <dd>${uptimeSec > 0 ? formatUptime(uptimeSec) : "—"}</dd>
        </dl>
      </div>`;

    requestAnimationFrame(() => panel.classList.add("open"));
    panel.querySelector("#info-sidebar-close").addEventListener("click", () => {
      panel.classList.remove("open");
      panel.addEventListener("transitionend", () => panel.remove(), { once: true });
    });
  }

  function renderServersTabShell(config = {}) {
    const {
      mountId,
      panelTitle = "Game Servers",
      panelIcon = "🖥",
      alertId = "services-alert",
      tableId = "services-table",
      tbodyId = "services-tbody",
    } = config;

    if (!mountId) {
      throw new Error("renderServersTabShell requires mountId");
    }

    const mount = document.getElementById(mountId);
    if (!mount) {
      throw new Error(`renderServersTabShell mount not found: ${mountId}`);
    }

    mount.innerHTML = `
      <div id="${alertId}" role="alert" aria-live="polite"></div>
      <div class="panel">
        <div class="panel__title">
          <span class="icon" aria-hidden="true">${panelIcon}</span>
          ${panelTitle}
        </div>
        <table class="tui-table" id="${tableId}" aria-label="Services table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Game</th>
              <th>Status</th>
              <th>Players</th>
              <th>PID</th>
              <th>CPU%</th>
              <th>RAM</th>
              <th>Uptime</th>
              <th>Port</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody id="${tbodyId}">
            <tr>
              <td colspan="10" style="text-align:center; color:var(--overlay0); padding:1.5rem">
                Loading services…
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  function initServersTab(config) {
    const {
      apiBasePath,
      tbodyId = "services-tbody",
      tableId = "services-table",
      alertId = "services-alert",
      countElementId = null,
      pollIntervalMs = 5000,
      gameIcons = DEFAULT_GAME_ICONS,
      onData = null,
      onActionMessage = null,
      onConsoleOpen = null,
    } = config || {};

    if (!apiBasePath) {
      throw new Error("initServersTab requires apiBasePath");
    }

    const tbody = document.getElementById(tbodyId);
    const table = document.getElementById(tableId);
    const alertEl = document.getElementById(alertId);
    const countEl = countElementId ? document.getElementById(countElementId) : null;

    let services = [];

    function renderRows(rows) {
      if (!tbody) return;
      const showConsoleButton = typeof onConsoleOpen === "function";

      if (rows.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="10" style="text-align:center; color:var(--overlay0); padding:1.5rem">
              No services configured
            </td>
          </tr>`;
        return;
      }

      tbody.innerHTML = rows.map((service) => {
        const serviceId = normalizeServiceId(service?.id);
        const safeName = String(service?.name || "Unknown service");
        const safeGame = String(service?.game || "Unknown");
        const status = normalizeServiceStatus(service?.status);
        const isRunning = status === "running";
        const isStopped = status === "stopped";
        const players = Math.max(0, toSafeInteger(service?.players, 0));
        const maxPlayers = Math.max(0, toSafeInteger(service?.maxPlayers, 0));
        const cpuPercent = Math.max(0, Math.min(100, toSafeInteger(service?.cpuPercent, 0)));
        const ramMb = Math.max(0, toSafeInteger(service?.ramMb, 0));
        const uptimeSec = Math.max(0, toSafeInteger(service?.uptimeSec, 0));
        const pid = service?.pid == null ? "—" : toSafeInteger(service?.pid, 0);
        const port = Math.max(0, toSafeInteger(service?.port, 0));
        const disabledForInvalidId = serviceId ? "" : "disabled";

        return `
        <tr data-nav-item tabindex="0" aria-label="${escapeHtml(safeName)} — ${escapeHtml(status)}">
          <td>
            <div class="svc-name">
              <span class="svc-game-icon">${gameIcons[safeGame] || gameIcons.default}</span>
              <strong class="svc-name__text">${escapeHtml(safeName)}</strong>
            </div>
          </td>
          <td>${escapeHtml(safeGame)}</td>
          <td>
            <span class="svc-status">
              <span class="svc-dot ${status}"></span>
              ${escapeHtml(status)}
            </span>
          </td>
          <td>
            <span class="svc-players">
              ${isStopped
                ? '<span class="text-muted">—</span>'
                : `<span class="current">${players}</span><span class="max">/${maxPlayers}</span>`}
            </span>
          </td>
          <td class="text-muted">${pid}</td>
          <td>${isStopped ? "—" : `${cpuPercent}%`}</td>
          <td>${isStopped ? "—" : `${ramMb} MB`}</td>
          <td class="text-muted">${uptimeSec > 0 ? formatUptime(uptimeSec) : "—"}</td>
          <td>${port}</td>
          <td>
            <div class="svc-actions">
              <button class="svc-icon-btn start" data-tooltip="Start" data-action="start" data-id="${escapeHtml(serviceId)}"
                aria-label="Start ${escapeHtml(safeName)}" ${isRunning ? "disabled" : disabledForInvalidId}>▶</button>
              ${showConsoleButton
                ? `<button class="svc-icon-btn console" data-tooltip="Console" data-action="console" data-id="${escapeHtml(serviceId)}"
                aria-label="Open console for ${escapeHtml(safeName)}" ${disabledForInvalidId}>&gt;_</button>`
                : ""}
              <button class="svc-icon-btn info" data-tooltip="More Info" data-action="info" data-id="${escapeHtml(serviceId)}"
                aria-label="Info ${escapeHtml(safeName)}" ${disabledForInvalidId}>ℹ</button>
              <div class="svc-actions-menu">
                <button class="svc-icon-btn menu" data-tooltip="Actions" data-action="toggle-menu" data-id="${escapeHtml(serviceId)}"
                  aria-label="More actions for ${escapeHtml(safeName)}" aria-haspopup="true" ${disabledForInvalidId}>≡</button>
                <div class="svc-dropdown" role="menu">
                  <button class="svc-dropdown__item stop" data-action="stop" data-id="${escapeHtml(serviceId)}"
                    role="menuitem" ${isStopped ? "disabled" : disabledForInvalidId}>
                    <span class="dd-icon">■</span> Stop
                  </button>
                  <button class="svc-dropdown__item restart" data-action="restart" data-id="${escapeHtml(serviceId)}"
                    role="menuitem" ${disabledForInvalidId}>
                    <span class="dd-icon">⟳</span> Restart
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>`;
      }).join("");
    }

    function updateCounts(rows) {
      const running = rows.filter((s) => normalizeServiceStatus(s?.status) === "running").length;
      if (countEl) countEl.textContent = running;
      if (typeof onData === "function") onData(rows, running);
    }

    async function refresh() {
      try {
        services = await apiFetch(apiBasePath);
        renderRows(services);
        updateCounts(services);
        if (table) enableListNav(table, "[data-nav-item]");
      } catch (err) {
        showAlert(alertEl, err.message, "error");
      }
    }

    async function act(service, action, successType) {
      const serviceId = normalizeServiceId(service?.id);
      if (!serviceId) {
        showAlert(alertEl, "Invalid service id.", "error");
        return;
      }
      try {
        const data = await apiFetch(`${apiBasePath}/${serviceId}/${action}`, { method: "POST" });
        showAlert(alertEl, data.message, successType);
        if (typeof onActionMessage === "function") {
          onActionMessage(data.message, successType, service);
        }
        await refresh();
      } catch (err) {
        showAlert(alertEl, err.message, "error");
      }
    }

    function closeAllDropdowns() {
      table.querySelectorAll(".svc-dropdown.open").forEach((d) => d.classList.remove("open"));
    }

    function bindTableActions() {
      if (!table) return;

      // Close open dropdowns when clicking anywhere outside
      document.addEventListener("click", (event) => {
        if (!event.target.closest(".svc-actions-menu")) {
          closeAllDropdowns();
        }
      });

      table.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;

        const { action, id } = button.dataset;
        const service = services.find((s) => normalizeServiceId(s?.id) === id);
        if (!service) return;

        if (action === "toggle-menu") {
          const dropdown = button.parentElement.querySelector(".svc-dropdown");
          const isOpen = dropdown.classList.contains("open");
          closeAllDropdowns();
          if (!isOpen) dropdown.classList.add("open");
          return;
        }

        // Close menu after selecting a dropdown item
        closeAllDropdowns();

        if (action === "console") {
          if (typeof onConsoleOpen === "function") {
            onConsoleOpen(service);
          }
          return;
        }

        if (action === "info") {
          showServerInfo(service, gameIcons);
          return;
        }

        if (action === "start") {
          act(service, "start", "success");
          return;
        }

        if (action === "stop") {
          showConfirmDialog({
            title: "Stop Server",
            message: "Are you sure you want to stop this game server? Active players will be disconnected.",
            confirmText: "■ Stop",
            onConfirm: () => act(service, "stop", "warning"),
          });
          return;
        }

        showConfirmDialog({
          title: "Restart Server",
          message: "This will restart the game server. Players may experience a brief disconnection.",
          confirmText: "⟳ Restart",
          onConfirm: () => act(service, "restart", "success"),
        });
      });
    }

    bindTableActions();
    refresh();
    const intervalId = setInterval(refresh, pollIntervalMs);

    return {
      refresh,
      destroy: () => clearInterval(intervalId),
    };
  }

  window.renderServersTabShell = renderServersTabShell;
  window.initServersTab = initServersTab;
})();
