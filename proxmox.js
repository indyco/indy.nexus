/**
 * proxmox.js — Proxmox VE REST API client
 *
 * Thin wrapper around Node 22's built-in fetch for communicating with the
 * Proxmox API.  Authenticates via PVE API tokens (no password/ticket flow).
 *
 * Environment variables consumed (validated in server.js):
 *   PROXMOX_HOST          — e.g. https://192.168.1.100:8006
 *   PROXMOX_NODE          — node name shown in the Proxmox sidebar (e.g. "pve")
 *   PROXMOX_TOKEN_ID      — e.g. root@pam!indynexus
 *   PROXMOX_TOKEN_SECRET  — UUID secret shown once when the token is created
 */

"use strict";

const https = require("https");

// Proxmox typically runs with a self-signed certificate.  Rather than
// disabling TLS verification globally (NODE_TLS_REJECT_UNAUTHORIZED=0), we
// scope the override to Proxmox-only requests via a custom Agent.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

let _host = "";
let _node = "";
let _authHeader = "";

/**
 * Initialise the client.  Call once at startup after validating env vars.
 */
function configure({ host, node, tokenId, tokenSecret }) {
  _host = host.replace(/\/+$/, ""); // strip trailing slash
  _node = node;
  _authHeader = `PVEAPIToken=${tokenId}=${tokenSecret}`;
}

/** Return the configured node name. */
function getNode() {
  return _node;
}

// -----------------------------------------------------------------------
// Low-level helpers
//
// We use Node's built-in https.request rather than the global fetch (undici)
// because undici does not support the classic `agent` option needed to skip
// TLS verification for Proxmox's self-signed certificate.
// -----------------------------------------------------------------------

function _request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${_host}${path}`);
    const headers = { Authorization: _authHeader };
    let payload;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 8006,
        path: url.pathname + url.search,
        method,
        headers,
        agent: insecureAgent,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(
              new Error(`Proxmox ${method} ${path} → ${res.statusCode}: ${raw}`)
            );
          }
          try {
            const json = JSON.parse(raw);
            resolve(json.data); // Proxmox wraps every response in { data: ... }
          } catch {
            resolve(raw);
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pveGet(path) {
  return _request("GET", path);
}

function pvePost(path, body = {}) {
  return _request("POST", path, body);
}

// -----------------------------------------------------------------------
// Container (LXC) operations
// -----------------------------------------------------------------------

/** Get current status of a single LXC container. */
async function getContainerStatus(vmid) {
  return pveGet(`/api2/json/nodes/${_node}/lxc/${vmid}/status/current`);
}

/** Start a stopped container.  Returns the UPID of the task. */
async function startContainer(vmid) {
  return pvePost(`/api2/json/nodes/${_node}/lxc/${vmid}/status/start`);
}

/** Stop a running container. */
async function stopContainer(vmid) {
  return pvePost(`/api2/json/nodes/${_node}/lxc/${vmid}/status/stop`);
}

/** Reboot a running container. */
async function rebootContainer(vmid) {
  return pvePost(`/api2/json/nodes/${_node}/lxc/${vmid}/status/reboot`);
}

// -----------------------------------------------------------------------
// Node-level queries
// -----------------------------------------------------------------------

/** Host-level resource usage (CPU, memory, uptime, etc.). */
async function getNodeStatus() {
  return pveGet(`/api2/json/nodes/${_node}/status`);
}

module.exports = {
  configure,
  getNode,
  getContainerStatus,
  startContainer,
  stopContainer,
  rebootContainer,
  getNodeStatus,
};
