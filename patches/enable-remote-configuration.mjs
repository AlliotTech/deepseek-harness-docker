import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Controlled remote provider configuration for the container image.
//
// Upstream admits every request that passes the Host/Origin fence (loopback,
// the listener's bind address, or a configured trusted host) plus browser or
// API-peer authentication as an owner Peer, with no per-endpoint restriction.
// This patch restores the container's policy:
//
// - Loopback requests keep full access.
// - Trusted non-loopback hosts reach only the provider configuration plane,
//   and only when DSH_ALLOW_REMOTE_CONFIGURATION=1 (fail-closed otherwise).
// - Native host operations (opening documents/paths/apps on the server,
//   directory picking, preset reads) stay loopback-only.
//
// Two transports carry RPC and both are gated:
// - HTTP `/api/<endpoint>`: gated in HostConnectionService.admit, which also
//   hands non-loopback requests a restricted-marked peer instead of the raw
//   admitted peer (requestRejection inherits the same policy via admit).
// - The WebSocket stream carrier (`/api/remote.mux`): admitConnection marks
//   the socket peer the same way, and the Typert gateway applies the same
//   endpoint policy to streams opened by a marked peer.
//
// The patch is version-checked and fail-closed: every replacement must match
// exactly once or the build aborts.
//
// Targets upstream @deepseek-ai/dsh 0.2.2-rc.5 (peer-based admission model).

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(process.argv[2] ?? defaultRoot)

const REMOTE_CONFIGURATION_METHODS = [
  'settings/describe',
  'settings/update',
  'settings/replace',
  'settings/mutate',
  'credentials/describe',
  'credentials/set',
  'credentials/unset',
  'llm/discoverModels',
]

const LOOPBACK_ONLY_PATH_PREFIXES = ['/open-in-app/']

function setLiteral(values) {
  return `new Set([\n${values.map((value) => `\t"${value}",`).join('\n')}\n])`
}

function arrayLiteral(values) {
  return `[\n${values.map((value) => `\t"${value}",`).join('\n')}\n]`
}

function patchFile(relativeTarget, replacements) {
  const target = resolve(root, relativeTarget)
  let source = readFileSync(target, 'utf8')
  for (const [before, after, description] of replacements) {
    const occurrences = source.split(before).length - 1
    if (occurrences !== 1) {
      throw new Error(`${target}: ${description}: expected one upstream match, found ${occurrences}`)
    }
    source = source.replace(before, after)
  }
  writeFileSync(target, source)
  console.log(`Patched ${target}`)
}

// ---------------------------------------------------------------------------
// dsh-client-connection: HTTP fence + remote peer marking
// ---------------------------------------------------------------------------

const connectionHelpers = `/* deepseek-harness-docker: controlled remote configuration (fail-closed). */
const DSH_REMOTE_CONFIGURATION_METHODS = ${setLiteral(REMOTE_CONFIGURATION_METHODS)};
const DSH_LOOPBACK_ONLY_PATH_PREFIXES = ${arrayLiteral(LOOPBACK_ONLY_PATH_PREFIXES)};
const DSH_REMOTE_RESTRICTED = Symbol.for("deepseek-harness-docker.remote-restricted");
const DSH_REMOTE_WRAPPERS = Symbol.for("deepseek-harness-docker.remote-wrappers");
function dshIsLoopbackRequest(request) {
\tconst host = header$1(request.headers, "host");
\tif (host === void 0) return false;
\tconst authority = parseAuthority(host);
\tif (authority === void 0) return false;
\treturn isLoopbackHostname(authority.hostname);
}
function dshApiEndpoint(pathname) {
\tif (!pathname.startsWith("/api/")) return null;
\treturn pathname.slice(5);
}
/** True when a non-loopback request must not reach its target. */
function dshRemoteRequestForbidden(request) {
\tif (dshIsLoopbackRequest(request)) return false;
\tlet pathname;
\ttry {
\t\tpathname = new URL(request.url ?? "/", "http://dsh.invalid").pathname;
\t} catch {
\t\treturn true;
\t}
\tconst endpoint = dshApiEndpoint(pathname);
\tif (endpoint === null) {
\t\treturn DSH_LOOPBACK_ONLY_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
\t}
\tif (endpoint === "remote.mux" || endpoint === "$events" || endpoint === "$events/result") return false;
\tif (DSH_REMOTE_CONFIGURATION_METHODS.has(endpoint)) {
\t\treturn process.env.DSH_ALLOW_REMOTE_CONFIGURATION !== "1";
\t}
\t// Fail-closed: a trusted non-loopback host reaches only the provider\n\t// configuration plane (plus the stream carrier, handled above). Every\n\t// other endpoint stays loopback-only even when not enumerated here.\n\treturn true;
}
/**
 * The peer to hand to this request's RPC handling. Loopback requests keep the
 * admitted peer as-is; non-loopback requests get a stable restricted wrapper
 * (one per underlying peer, cached on the service) so the shared browser peer
 * is never mutated and gateway identity checks keep seeing a consistent object.
 */
function dshPeerForRequest(service, request, peer) {
\tif (dshIsLoopbackRequest(request)) return peer;
\tlet cache = service[DSH_REMOTE_WRAPPERS];
\tif (cache === void 0) cache = service[DSH_REMOTE_WRAPPERS] = new WeakMap();
\tlet wrapped = cache.get(peer);
\tif (wrapped === void 0) {
\t\twrapped = Object.create(peer, { [DSH_REMOTE_RESTRICTED]: { value: true } });
\t\tcache.set(peer, wrapped);
\t}
\treturn wrapped;
}
/** Host registry and HTTP adapter for generic Connection RPC channels. */`

patchFile('node_modules/@deepseek-ai/dsh-client-connection/lib/index.js', [
  [
    '/** Host registry and HTTP adapter for generic Connection RPC channels. */',
    connectionHelpers,
    'remote configuration helpers',
  ],
  [
    `\t/** Browser requests share an owner Peer; API HTTP does not depend on an attached socket. */
\tadmit(request) {
\t\tif (!this.isTrusted(request)) return { rejection: 403 };
\t\tif (this.disposed) return { rejection: 401 };
\t\tconst secure = this.owner.get("webServer")?.protocol === "https:";
\t\tif (this.browserAuth.isAuthenticated(request, secure)) return { peer: this.browserPeer };
\t\tconst id = this.browserAuth.authenticateApi(request, secure);
\t\tconst record = id === void 0 ? void 0 : this.peers.get(id);
\t\treturn record === void 0 ? { rejection: 401 } : { peer: record.peer };
\t}`,
    `\t/** Browser requests share an owner Peer; API HTTP does not depend on an attached socket. */
\tadmit(request) {
\t\tif (!this.isTrusted(request)) return { rejection: 403 };
\t\tif (dshRemoteRequestForbidden(request)) return { rejection: 403 };
\t\tif (this.disposed) return { rejection: 401 };
\t\tconst secure = this.owner.get("webServer")?.protocol === "https:";
\t\tif (this.browserAuth.isAuthenticated(request, secure)) return { peer: dshPeerForRequest(this, request, this.browserPeer) };
\t\tconst id = this.browserAuth.authenticateApi(request, secure);
\t\tconst record = id === void 0 ? void 0 : this.peers.get(id);
\t\treturn record === void 0 ? { rejection: 401 } : { peer: dshPeerForRequest(this, request, record.peer) };
\t}`,
    'admission fence and remote peer marking',
  ],
  [
    `\t\tif (record.ownsSocket) return { rejection: 409 };
\t\trecord.ownsSocket = true;
\t\tlet released;
\t\treturn {
\t\t\tpeer: record.peer,`,
    `\t\tif (record.ownsSocket) return { rejection: 409 };
\t\trecord.ownsSocket = true;
\t\tlet released;
\t\treturn {
\t\t\tpeer: dshPeerForRequest(this, request, record.peer),`,
    'socket peer marking',
  ],
])

// ---------------------------------------------------------------------------
// dsh-api-gateway: per-endpoint policy for the stream carrier
// ---------------------------------------------------------------------------

const gatewayHelpers = `/* deepseek-harness-docker: controlled remote configuration (fail-closed).
 * dsh-client-connection marks the peer of non-loopback (trusted-host) requests;
 * streams opened over the WebSocket carrier thread that peer through
 * openWireStream/dispatchRpc, so the same endpoint policy enforced on HTTP RPC
 * applies here. */
const DSH_GATEWAY_REMOTE_CONFIGURATION_METHODS = ${setLiteral(REMOTE_CONFIGURATION_METHODS)};
const DSH_GATEWAY_REMOTE_RESTRICTED = Symbol.for("deepseek-harness-docker.remote-restricted");
function dshGatewayEndpointForbidden(endpoint, peer) {
\tif (peer == null || peer[DSH_GATEWAY_REMOTE_RESTRICTED] !== true) return false;
\tif (endpoint === "$events" || endpoint === "$events/result") return false;
\tif (DSH_GATEWAY_REMOTE_CONFIGURATION_METHODS.has(endpoint)) {
\t\treturn process.env.DSH_ALLOW_REMOTE_CONFIGURATION !== "1";
\t}
\treturn true;
}
/**
* Resolve strict generated definitions or conservative SRC markers against`

patchFile('node_modules/@deepseek-ai/dsh-api-gateway/lib/index.js', [
  [
    `/**
* Resolve strict generated definitions or conservative SRC markers against`,
    gatewayHelpers,
    'remote configuration helpers',
  ],
  [
    `\tasync dispatchRpc(endpoint, payload, signal, peer) {
\t\tif (endpoint === "$events/result") try {`,
    `\tasync dispatchRpc(endpoint, payload, signal, peer) {
\t\tif (dshGatewayEndpointForbidden(endpoint, peer)) {
\t\t\treturn rpcFailure(new TypertGatewayError("gateway/forbidden", endpoint, "remote requests may not invoke this endpoint"));
\t\t}
\t\tif (endpoint === "$events/result") try {`,
    'stream carrier unary gate',
  ],
  [
    `\tasync openWireStream(endpoint, payload, uplink, peer, signal, control, uplinkWindow) {
\t\tif (endpoint === "$events") {`,
    `\tasync openWireStream(endpoint, payload, uplink, peer, signal, control, uplinkWindow) {
\t\tif (dshGatewayEndpointForbidden(endpoint, peer)) {
\t\t\tthrow new TypertGatewayError("gateway/forbidden", endpoint, "remote requests may not open this endpoint");
\t\t}
\t\tif (endpoint === "$events") {`,
    'stream carrier gate',
  ],
])
