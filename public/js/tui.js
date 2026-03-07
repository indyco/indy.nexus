/**
 * indy.nexus — TUI navigation & utilities
 * Keyboard and mouse navigation helpers for the TUI interface.
 */

"use strict";

/* ── Auth helpers ──────────────────────────────────────────── */

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(options.headers || {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function getMe() {
  try {
    return await apiFetch("/api/me");
  } catch {
    return { authenticated: false };
  }
}

/* ── Navigation guard ──────────────────────────────────────── */

async function requireAuth(redirectTo = "/login.html") {
  const me = await getMe();
  if (!me.authenticated) {
    window.location.href = redirectTo;
    return null;
  }
  return me;
}

async function requireAdmin(redirectTo = "/dashboard.html") {
  const me = await getMe();
  if (!me.authenticated) {
    window.location.href = "/login.html";
    return null;
  }
  if (me.role !== "admin") {
    window.location.href = redirectTo;
    return null;
  }
  return me;
}

async function redirectIfLoggedIn(redirectTo = "/dashboard.html") {
  const me = await getMe();
  if (me.authenticated) {
    window.location.href = redirectTo;
  }
}

/* ── Status bar clock ──────────────────────────────────────── */

function startClock(el) {
  if (!el) return;
  function tick() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
  tick();
  setInterval(tick, 1000);
}

/* ── Alert / notification helpers ─────────────────────────── */

function showAlert(container, message, type = "error") {
  if (!container) return;
  const icons = { error: "✖", success: "✔", warning: "▲", info: "ℹ" };
  container.innerHTML = `
    <div class="alert alert--${type}" role="alert">
      <span class="alert__icon">${icons[type] || icons.info}</span>
      <span>${escapeHtml(message)}</span>
    </div>`;
  container.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearAlert(container) {
  if (container) container.innerHTML = "";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ── Keyboard navigation for lists/tables ──────────────────── */

/**
 * Enable arrow-key navigation on a container's focusable children.
 * @param {HTMLElement} container - parent element
 * @param {string} selector - CSS selector for navigable items
 */
function enableListNav(container, selector = "[data-nav-item]") {
  if (!container) return;

  container.addEventListener("keydown", (e) => {
    const items = Array.from(container.querySelectorAll(selector)).filter(
      (el) => !el.closest("[hidden]") && !el.closest(".hidden")
    );
    if (items.length === 0) return;

    const focused = document.activeElement;
    const idx = items.indexOf(focused);

    switch (e.key) {
      case "ArrowDown":
      case "j":
        e.preventDefault();
        (items[idx + 1] || items[0]).focus();
        break;
      case "ArrowUp":
      case "k":
        e.preventDefault();
        (items[idx - 1] || items[items.length - 1]).focus();
        break;
      case "Home":
        e.preventDefault();
        items[0].focus();
        break;
      case "End":
        e.preventDefault();
        items[items.length - 1].focus();
        break;
    }
  });
}

/**
 * Enable tab-strip keyboard navigation (Left/Right arrows).
 * @param {HTMLElement} strip - the tab strip container
 * @param {Function} onSelect - callback(tabId)
 */
function enableTabNav(strip, onSelect) {
  if (!strip) return;
  strip.addEventListener("keydown", (e) => {
    const tabs = Array.from(strip.querySelectorAll(".tab-strip__tab"));
    const idx = tabs.indexOf(document.activeElement);
    if (idx === -1) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = tabs[(idx + 1) % tabs.length];
      next.focus();
      next.click();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      prev.focus();
      prev.click();
    }
  });
}

/**
 * Enable sidebar keyboard navigation (Up/Down arrows).
 */
function enableSidebarNav(sidebar) {
  enableListNav(sidebar, ".sidebar__item");
}

/* ── Button loading state ──────────────────────────────────── */

function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.classList.add("loading");
    btn.disabled = true;
    btn.dataset.origText = btn.querySelector(".btn-text")?.textContent || "";
  } else {
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}

/* ── Logout helper ─────────────────────────────────────────── */

async function logout() {
  try {
    await apiFetch("/api/logout", { method: "POST" });
  } finally {
    window.location.href = "/";
  }
}

/* ── Global keyboard shortcuts ─────────────────────────────── */

function registerGlobalShortcuts(shortcuts) {
  document.addEventListener("keydown", (e) => {
    // Ignore when typing in an input
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.isContentEditable
    ) {
      return;
    }
    const key = (e.ctrlKey ? "ctrl+" : "") + (e.altKey ? "alt+" : "") + e.key;
    const handler = shortcuts[key] || shortcuts[e.key];
    if (handler) {
      e.preventDefault();
      handler(e);
    }
  });
}

/* ── Confirmation dialog ───────────────────────────────────── */

function showConfirmDialog({ title, message, confirmText = "Confirm", onConfirm }) {
  const existing = document.getElementById("confirm-dialog-backdrop");
  if (existing) existing.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.id = "confirm-dialog-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", title);

  backdrop.innerHTML = `
    <div class="dialog" style="max-width:380px">
      <div class="dialog__header">
        <span class="dialog__title">⚠ ${escapeHtml(title)}</span>
        <button class="dialog__close" id="confirm-cancel" aria-label="Cancel">✕</button>
      </div>
      <div class="dialog__body" style="font-size:0.85rem; color:var(--subtext1)">
        ${escapeHtml(message)}
      </div>
      <div class="dialog__footer">
        <button class="btn btn--ghost btn--sm" id="confirm-no">Cancel</button>
        <button class="btn btn--danger btn--sm" id="confirm-yes">${escapeHtml(confirmText)}</button>
      </div>
    </div>`;

  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();

  backdrop.querySelector("#confirm-cancel").addEventListener("click", close);
  backdrop.querySelector("#confirm-no").addEventListener("click", close);
  backdrop.querySelector("#confirm-yes").addEventListener("click", () => {
    close();
    onConfirm();
  });

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  backdrop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // Focus the confirm button
  backdrop.querySelector("#confirm-yes").focus();
}

/* ── Fake log line generator (for demo) ───────────────────── */

function appendLog(logEl, level, text) {
  if (!logEl) return;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const line = document.createElement("div");
  line.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-${level}">${escapeHtml(text)}</span>`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

/* ── Init status bar ───────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => {
  startClock(document.getElementById("statusbar-clock"));
});
