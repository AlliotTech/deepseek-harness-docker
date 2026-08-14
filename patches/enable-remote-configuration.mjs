import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(process.argv[2] ?? defaultRoot)
const target = resolve(root, 'node_modules/@deepseek-ai/dsh-client-connection/lib/index.js')

let source = readFileSync(target, 'utf8')

function replaceExactlyOnce(before, after, description) {
  const occurrences = source.split(before).length - 1
  if (occurrences !== 1) {
    throw new Error(`${description}: expected one upstream match, found ${occurrences}`)
  }
  source = source.replace(before, after)
}

replaceExactlyOnce(
  `const PRIVILEGED_METHODS = new Set([
\t"agentPreset.read",
\t"agentPreset.copy",
\t"agentPreset.openDocument",
\t"agentPreset.remove",
\t"host.pickDirectory",
\t"host.openPath",
\t"settings.describe",
\t"settings.openDocument",
\t"settings.update",
\t"settings.replace",
\t"settings.mutate",
\t"credentials.describe",
\t"credentials.set",
\t"credentials.unset",
\t"llm.discoverModels"
]);`,
  `const PRIVILEGED_METHODS = new Set([
\t"agentPreset.read",
\t"agentPreset.copy",
\t"agentPreset.openDocument",
\t"agentPreset.remove",
\t"host.pickDirectory",
\t"host.openPath",
\t"settings.describe",
\t"settings.openDocument",
\t"settings.update",
\t"settings.replace",
\t"settings.mutate",
\t"credentials.describe",
\t"credentials.set",
\t"credentials.unset",
\t"llm.discoverModels"
]);
const REMOTE_CONFIGURATION_METHODS = new Set([
\t"settings.describe",
\t"settings.update",
\t"settings.replace",
\t"settings.mutate",
\t"credentials.describe",
\t"credentials.set",
\t"credentials.unset",
\t"llm.discoverModels"
]);`,
  'privileged method registry',
)

replaceExactlyOnce(
  `\tconst trustedHosts = config?.trustedHosts ?? [];
\tconst maxRequestBodyBytes = config?.maxRequestBodyBytes ?? 167772160;`,
  `\tconst trustedHosts = config?.trustedHosts ?? [];
\tconst remoteConfigurationHosts = process.env.DSH_ALLOW_REMOTE_CONFIGURATION === "1" ? trustedHosts : [];
\tconst maxRequestBodyBytes = config?.maxRequestBodyBytes ?? 167772160;`,
  'remote configuration trust list',
)

replaceExactlyOnce(
  `\t\tif (method !== void 0 && PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, [])) return new Response("forbidden", { status: 403 });`,
  `\t\tif (method !== void 0 && PRIVILEGED_METHODS.has(method)) {
\t\t\tconst acceptedHosts = REMOTE_CONFIGURATION_METHODS.has(method) ? remoteConfigurationHosts : [];
\t\t\tif (!isTrustedApiRequest(request, acceptedHosts)) return new Response("forbidden", { status: 403 });
\t\t}`,
  'privileged request fence',
)

writeFileSync(target, source)
console.log(`Patched ${target}`)
