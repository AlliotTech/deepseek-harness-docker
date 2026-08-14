import { readFileSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import { spawn } from 'node:child_process'

const DEFAULT_PUBLIC_PORT = 3080
const DEFAULT_INTERNAL_PORT = 3081
const DSH_CLI = '/opt/deepseek-harness/node_modules/@deepseek-ai/dsh/lib/bin.js'
const SHUTDOWN_TIMEOUT_MS = 7000

function fail(message) {
  console.error(`deepseek-harness-docker: ${message}`)
  process.exit(1)
}

function parsePort(name, fallback) {
  const raw = process.env[name] ?? String(fallback)
  if (!/^\d+$/.test(raw)) fail(`${name} must be an integer from 1 to 65535`)
  const value = Number(raw)
  if (value < 1 || value > 65535) fail(`${name} must be an integer from 1 to 65535`)
  return value
}

function loadSecretFile(variable, fileVariable) {
  const file = process.env[fileVariable]
  if (process.env[variable] || !file) return
  try {
    process.env[variable] = readFileSync(file, 'utf8').trimEnd()
  } catch (error) {
    fail(`cannot read ${fileVariable}=${JSON.stringify(file)}: ${error.message}`)
  }
}

function runChild(command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })

  let stopping = false
  const forward = (signal) => {
    if (stopping) return
    stopping = true
    child.kill(signal)
    setTimeout(() => child.kill('SIGKILL'), SHUTDOWN_TIMEOUT_MS).unref()
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => forward(signal))
  }

  child.once('error', (error) => fail(`cannot start ${command}: ${error.message}`))
  child.once('exit', (code, signal) => {
    if (code !== null) process.exit(code)
    process.exit(signal === 'SIGINT' ? 130 : 1)
  })
  return child
}

function containsManagedWebFlag(args) {
  return args.some((arg) => arg === '--host' || arg.startsWith('--host=')
    || arg === '--port' || arg.startsWith('--port='))
}

function trustedHostArgs() {
  const raw = process.env.DSH_TRUSTED_HOSTS
  if (!raw) return []
  const authorities = raw.split(',').map((value) => value.trim()).filter(Boolean)
  return authorities.length === 0 ? [] : ['--trusted-host', ...authorities]
}

function normalizeBooleanEnvironment(name) {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return false

  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    process.env[name] = '1'
    return true
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    process.env[name] = '0'
    return false
  }
  fail(`${name} must be a boolean (1/0, true/false, yes/no, or on/off)`)
}

function runWeb(webArgs) {
  if (webArgs.includes('--help') || webArgs.includes('-h')) {
    runChild(process.execPath, ['--expose-internals', DSH_CLI, 'web', ...webArgs])
    return
  }
  if (containsManagedWebFlag(webArgs)) {
    fail('the container manages --host and --port; use DSH_PORT and the Docker port mapping instead')
  }

  const publicPort = parsePort('DSH_PORT', DEFAULT_PUBLIC_PORT)
  const internalPort = parsePort('DSH_INTERNAL_PORT', DEFAULT_INTERNAL_PORT)
  if (publicPort === internalPort) fail('DSH_PORT and DSH_INTERNAL_PORT must be different')

  loadSecretFile('DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY_FILE')
  const trustedArgs = trustedHostArgs()
  const allowRemoteConfiguration = normalizeBooleanEnvironment('DSH_ALLOW_REMOTE_CONFIGURATION')
  if (allowRemoteConfiguration && trustedArgs.length === 0) {
    fail('DSH_ALLOW_REMOTE_CONFIGURATION requires at least one DSH_TRUSTED_HOSTS authority')
  }
  if (allowRemoteConfiguration) {
    console.warn('deepseek-harness-docker: remote provider configuration is enabled; require authentication and HTTPS at the reverse proxy')
  }

  // The HMR service used by `dsh web` accesses Node internals. Invoking the
  // package's shebang through `dsh` would start a fresh Node process without
  // this required runtime flag, so launch the CLI with Node explicitly.
  const child = spawn(process.execPath, [
    '--expose-internals',
    DSH_CLI,
    'web',
    '--port',
    String(internalPort),
    ...webArgs,
    ...trustedArgs,
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })

  const sockets = new Set()
  const server = createServer((client) => {
    sockets.add(client)
    const upstream = connect({ host: '127.0.0.1', port: internalPort })
    sockets.add(upstream)

    client.pipe(upstream)
    upstream.pipe(client)

    const closePair = () => {
      sockets.delete(client)
      sockets.delete(upstream)
      client.destroy()
      upstream.destroy()
    }
    client.on('error', closePair)
    upstream.on('error', closePair)
    client.on('close', closePair)
    upstream.on('close', closePair)
  })

  let stopping = false
  let exitCode = 1
  const closeProxy = () => {
    server.close()
    for (const socket of sockets) socket.destroy()
  }
  const stop = (signal) => {
    if (stopping) return
    stopping = true
    closeProxy()
    child.kill(signal)
    setTimeout(() => child.kill('SIGKILL'), SHUTDOWN_TIMEOUT_MS).unref()
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => stop(signal))
  }

  child.once('error', (error) => {
    console.error(`deepseek-harness-docker: cannot start dsh web: ${error.message}`)
    closeProxy()
    process.exit(1)
  })
  child.once('exit', (code, signal) => {
    exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)
    closeProxy()
    process.exit(exitCode)
  })
  server.once('error', (error) => {
    console.error(`deepseek-harness-docker: TCP bridge failed: ${error.message}`)
    closeProxy()
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), SHUTDOWN_TIMEOUT_MS).unref()
    process.exit(1)
  })
  server.listen(publicPort, '0.0.0.0', () => {
    console.log(`deepseek-harness-docker: forwarding 0.0.0.0:${publicPort} to 127.0.0.1:${internalPort}`)
  })
}

let args = process.argv.slice(2)
if (args.length === 0) args = ['web']

if (args[0] === 'web') {
  runWeb(args.slice(1))
} else if (args[0] === 'dsh' && args[1] === 'web') {
  runWeb(args.slice(2))
} else if (args[0].startsWith('-')) {
  loadSecretFile('DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY_FILE')
  runChild('dsh', args)
} else {
  loadSecretFile('DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY_FILE')
  runChild(args[0], args.slice(1))
}
