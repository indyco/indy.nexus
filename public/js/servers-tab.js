"use strict";

(function () {
  const DEFAULT_GAME_ICONS = {
    Minecraft: "⛏",
    Valheim: "⚔",
    CS2: "🎯",
    ARK: "🦕",
    default: "🖥",
  };

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

    const statusLabel = {
      running: `<span style="color:var(--green)">● running</span>`,
      stopped: `<span style="color:var(--overlay0)">● stopped</span>`,
      starting: `<span style="color:var(--blue)">● starting</span>`,
    }[service.status] || escapeHtml(service.status);

    panel.innerHTML = `
      <div class="info-sidebar__header">
        <span class="info-sidebar__title">ℹ ${escapeHtml(service.name)}</span>
        <button class="info-sidebar__close" id="info-sidebar-close" aria-label="Close">✕</button>
      </div>
      <div class="info-sidebar__body">
        <dl class="info-grid">
          <dt>Game</dt>      <dd>${gameIcons[service.game] || gameIcons.default} ${escapeHtml(service.game)}</dd>
          <dt>Status</dt>    <dd>${statusLabel}</dd>
          <dt>Players</dt>   <dd>${service.status === "stopped" ? "—" : service.players + " / " + service.maxPlayers}</dd>
          <dt>Port</dt>      <dd>${service.port}</dd>
          <dt>PID</dt>       <dd>${service.pid ?? "—"}</dd>
          <dt>CPU</dt>       <dd>${service.status === "stopped" ? "—" : service.cpuPercent + "%"}</dd>
          <dt>RAM</dt>       <dd>${service.status === "stopped" ? "—" : service.ramMb + " MB"}</dd>
          <dt>Uptime</dt>    <dd>${service.uptimeSec > 0 ? formatUptime(service.uptimeSec) : "—"}</dd>
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
        const isRunning = service.status === "running";
        const isStopped = service.status === "stopped";

        return `
        <tr data-nav-item tabindex="0" aria-label="${escapeHtml(service.name)} — ${escapeHtml(service.status)}">
          <td>
            <div class="svc-name">
              <span class="svc-game-icon">${gameIcons[service.game] || gameIcons.default}</span>
              <strong class="svc-name__text">${escapeHtml(service.name)}</strong>
            </div>
          </td>
          <td>${escapeHtml(service.game)}</td>
          <td>
            <span class="svc-status">
              <span class="svc-dot ${service.status}"></span>
              ${escapeHtml(service.status)}
            </span>
          </td>
          <td>
            <span class="svc-players">
              ${isStopped
                ? '<span class="text-muted">—</span>'
                : `<span class="current">${service.players}</span><span class="max">/${service.maxPlayers}</span>`}
            </span>
          </td>
          <td class="text-muted">${service.pid ?? "—"}</td>
          <td>${isStopped ? "—" : service.cpuPercent + "%"}</td>
          <td>${isStopped ? "—" : service.ramMb + " MB"}</td>
          <td class="text-muted">${service.uptimeSec > 0 ? formatUptime(service.uptimeSec) : "—"}</td>
          <td>${service.port}</td>
          <td>
            <div class="svc-actions">
              <button class="svc-icon-btn start" data-tooltip="Start" data-action="start" data-id="${service.id}"
                aria-label="Start ${escapeHtml(service.name)}" ${isRunning ? "disabled" : ""}>▶</button>
              <button class="svc-icon-btn stop" data-tooltip="Stop" data-action="stop" data-id="${service.id}"
                aria-label="Stop ${escapeHtml(service.name)}" ${isStopped ? "disabled" : ""}>■</button>
              <button class="svc-icon-btn restart" data-tooltip="Restart" data-action="restart" data-id="${service.id}"
                aria-label="Restart ${escapeHtml(service.name)}">⟳</button>
              <button class="svc-icon-btn info" data-tooltip="More Info" data-action="info" data-id="${service.id}"
                aria-label="Info ${escapeHtml(service.name)}">ℹ</button>
            </div>
          </td>
        </tr>`;
      }).join("");
    }

    function updateCounts(rows) {
      const running = rows.filter((s) => s.status === "running").length;
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

    async function act(id, action, successType) {
      try {
        const data = await apiFetch(`${apiBasePath}/${id}/${action}`, { method: "POST" });
        showAlert(alertEl, data.message, successType);
        if (typeof onActionMessage === "function") {
          onActionMessage(data.message, successType);
        }
        await refresh();
      } catch (err) {
        showAlert(alertEl, err.message, "error");
      }
    }

    function bindTableActions() {
      if (!table) return;
      table.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;

        const { action, id } = button.dataset;
        const service = services.find((s) => s.id === id);
        if (!service) return;

        if (action === "info") {
          showServerInfo(service, gameIcons);
          return;
        }

        if (action === "start") {
          act(id, "start", "success");
          return;
        }

        if (action === "stop") {
          showConfirmDialog({
            title: "Stop Server",
            message: "Are you sure you want to stop this game server? Active players will be disconnected.",
            confirmText: "■ Stop",
            onConfirm: () => act(id, "stop", "warning"),
          });
          return;
        }

        showConfirmDialog({
          title: "Restart Server",
          message: "This will restart the game server. Players may experience a brief disconnection.",
          confirmText: "⟳ Restart",
          onConfirm: () => act(id, "restart", "success"),
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
