import { ChildProcess, spawn } from 'child_process'
import * as net from 'net'
import {
  OPENCODE_DISABLE_CLAUDE_CODE,
  OPENCODE_DISABLE_DEFAULT_PLUGINS,
  OPENCODE_SERVER_HOST,
  OPENCODE_SERVER_PORT,
  OPENCODE_TIMEOUT_MS,
} from '../config/constants.js'
import { delay } from '../utils/utils.js'

export type OpencodeAiModel = `opencode:${string}` | `opencode/${string}`

interface OpenCodeModelConfig {
  providerID: string
  modelID: string
  variant?: string
}

interface OpenCodeSession {
  id: string
}

interface OpenCodeMessagePart {
  type: string
  text?: string
}

interface OpenCodeMessageResponse {
  info?: {
    error?: {
      message?: string
      data?: {
        message?: string
      }
    }
  }
  parts?: OpenCodeMessagePart[]
}

const OPENCODE_AGENT_NAME = 'direct-reply'

let serverProcess: ChildProcess | null = null
let serverStartPromise: Promise<void> | null = null
let serverPort = OPENCODE_SERVER_PORT

function getServerBaseUrl(): string {
  return `http://${OPENCODE_SERVER_HOST}:${serverPort}`
}

function splitVariant(raw: string): { body: string; variant?: string } {
  const atIndex = raw.lastIndexOf('@')
  if (atIndex <= 0) {
    return { body: raw }
  }
  return { body: raw.slice(0, atIndex), variant: raw.slice(atIndex + 1) }
}

function parseOpencodeModel(model: string): OpenCodeModelConfig | null {
  const { body: stripped, variant } = splitVariant(model)

  if (stripped.startsWith('opencode:')) {
    const remainder = stripped.slice('opencode:'.length)
    const colonIndex = remainder.indexOf(':')
    const slashIndex = remainder.indexOf('/')
    const separatorIndex =
      colonIndex === -1
        ? slashIndex
        : slashIndex === -1
          ? colonIndex
          : Math.min(colonIndex, slashIndex)

    if (separatorIndex === -1) {
      return null
    }

    const providerID = remainder.slice(0, separatorIndex).trim()
    const modelID = remainder.slice(separatorIndex + 1).trim()

    if (providerID && modelID) {
      return { providerID, modelID, variant }
    }

    return null
  }

  if (stripped.startsWith('opencode/')) {
    const remainder = stripped.slice('opencode/'.length)
    const separatorIndex = remainder.indexOf('/')

    if (separatorIndex === -1) {
      return null
    }

    const providerID = remainder.slice(0, separatorIndex).trim()
    const modelID = remainder.slice(separatorIndex + 1).trim()

    if (providerID && modelID) {
      return { providerID, modelID, variant }
    }
  }

  return null
}

export function isOpencodeAiModel(model: string): model is OpencodeAiModel {
  return parseOpencodeModel(model) !== null
}

async function isServerHealthy(): Promise<boolean> {
  if (!serverPort) {
    return false
  }

  try {
    const response = await fetch(`${getServerBaseUrl()}/global/health`)
    return response.ok
  } catch {
    return false
  }
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()

    probe.once('error', reject)
    probe.listen(0, OPENCODE_SERVER_HOST, () => {
      const address = probe.address()

      if (!address || typeof address !== 'object') {
        probe.close()
        reject(new Error('Unable to resolve a free local port for OpenCode'))
        return
      }

      const freePort = address.port
      probe.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve(freePort)
        }
      })
    })
  })
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<T> {
  let effectiveSignal = signal
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  if (timeoutMs !== undefined) {
    const controller = new AbortController()
    timeoutId = setTimeout(
      () => controller.abort(new Error(`OpenCode request timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
    }
    effectiveSignal = controller.signal
  }

  try {
    const response = await fetch(url, {
      ...init,
      signal: effectiveSignal,
    })

    const responseText = await response.text()

    if (!response.ok) {
      throw new Error(`OpenCode request failed (${response.status}): ${responseText}`)
    }

    if (!responseText.trim()) {
      return {} as T
    }

    return JSON.parse(responseText) as T
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

async function startOpencodeServer(logPrefix: string): Promise<void> {
  if (await isServerHealthy()) {
    return
  }

  if (!serverPort) {
    serverPort = await findFreePort()
  }

  const env: NodeJS.ProcessEnv = { ...process.env }

  delete env.OPENCODE_SERVER_PASSWORD
  delete env.OPENCODE_SERVER_USERNAME

  if (OPENCODE_DISABLE_CLAUDE_CODE) {
    env.OPENCODE_DISABLE_CLAUDE_CODE = '1'
  }

  if (OPENCODE_DISABLE_DEFAULT_PLUGINS) {
    env.OPENCODE_DISABLE_DEFAULT_PLUGINS = '1'
  }

  let output = ''

  console.log(`${logPrefix} - Starting OpenCode server on ${OPENCODE_SERVER_HOST}:${serverPort}...`)

  serverProcess = spawn(
    'opencode',
    ['serve', '--hostname', OPENCODE_SERVER_HOST, '--port', String(serverPort)],
    {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  )

  serverProcess.stdout?.on('data', (data: Buffer) => {
    output += data.toString()
  })

  serverProcess.stderr?.on('data', (data: Buffer) => {
    output += data.toString()
  })

  serverProcess.on('exit', () => {
    serverProcess = null
    serverStartPromise = null
  })

  for (let attempt = 0; attempt < 20; attempt++) {
    if (output.includes('opencode server listening on')) {
      console.log(`${logPrefix} - OpenCode server ready.`)
      return
    }

    if (await isServerHealthy()) {
      console.log(`${logPrefix} - OpenCode server ready.`)
      return
    }

    if (serverProcess.exitCode !== null) {
      break
    }

    await delay(500)
  }

  throw new Error(`OpenCode server did not become ready. Output: ${output.trim() || 'no output'}`)
}

export async function ensureOpencodeServer(logPrefix: string): Promise<void> {
  if (await isServerHealthy()) {
    return
  }

  if (!serverStartPromise) {
    serverStartPromise = startOpencodeServer(logPrefix).catch((error) => {
      serverStartPromise = null
      throw error
    })
  }

  await serverStartPromise
}

async function abortSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${getServerBaseUrl()}/session/${encodeURIComponent(sessionId)}/abort`, {
      method: 'POST',
    })
  } catch {}
}

async function deleteSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${getServerBaseUrl()}/session/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    })
  } catch {}
}

export async function stopOpencodeServer(): Promise<void> {
  if (!serverProcess) {
    return
  }

  const child = serverProcess
  serverProcess = null
  serverStartPromise = null

  if (child.exitCode !== null) {
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }

    const timer = setTimeout(finish, 1000)
    child.once('exit', () => {
      clearTimeout(timer)
      finish()
    })
    child.kill()
  })
}

export async function callOpencodeCli(
  prompt: string,
  logPrefix: string,
  model: OpencodeAiModel,
  signal?: AbortSignal
): Promise<string | undefined> {
  const parsedModel = parseOpencodeModel(model)

  if (!parsedModel) {
    console.error(`${logPrefix} - Invalid OpenCode model format: ${model}`)
    return undefined
  }

  try {
    await ensureOpencodeServer(logPrefix)

    const variantLabel = parsedModel.variant ? ` (variant: ${parsedModel.variant})` : ''
    console.log(
      `${logPrefix} - Calling OpenCode with model: ${parsedModel.providerID}/${parsedModel.modelID}${variantLabel}...`
    )

    const session = await requestJson<OpenCodeSession>(
      `${getServerBaseUrl()}/session`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
      signal
    )

    const abortListener = () => {
      void abortSession(session.id)
    }

    signal?.addEventListener('abort', abortListener, { once: true })

    try {
      const response = await requestJson<OpenCodeMessageResponse>(
        `${getServerBaseUrl()}/session/${encodeURIComponent(session.id)}/message`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            agent: OPENCODE_AGENT_NAME,
            model: {
              providerID: parsedModel.providerID,
              modelID: parsedModel.modelID,
              ...(parsedModel.variant ? { variant: parsedModel.variant } : {}),
            },
            parts: [{ type: 'text', text: prompt }],
          }),
        },
        signal,
        OPENCODE_TIMEOUT_MS
      )

      const responseText = (response.parts || [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text!.trim())
        .filter(Boolean)
        .join('\n\n')

      if (responseText) {
        console.log(`${logPrefix} - OpenCode response received (${responseText.length} chars).`)
        return responseText
      }

      const errorMessage = response.info?.error?.data?.message || response.info?.error?.message
      if (errorMessage) {
        console.error(`${logPrefix} - OpenCode returned an error: ${errorMessage}`)
      } else {
        console.error(`${logPrefix} - OpenCode returned an empty response.`)
      }
    } finally {
      signal?.removeEventListener('abort', abortListener)
      await deleteSession(session.id)
    }
  } catch (err) {
    console.error(`${logPrefix} - Error calling OpenCode:`, err)
  }

  return undefined
}
