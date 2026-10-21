import {
  PREFLIGHT_OTHER_RUNTIME_REFUSAL_RUNTIME_CAPABILITY,
  PREFLIGHT_WORKSPACE_SCOPED_RUNTIME_CAPABILITY,
  WORKSPACE_ON_OTHER_RUNTIME
} from '../../../src/shared/protocol-version'
import { newTabSettingsRead } from '../transport/settings-read-operations'
import {
  type MobileRuntimeRepoSummary,
  newTabRepoListRead,
  preflightDetectAgentsRead,
  preflightDetectRemoteAgentsRead,
  preflightRefreshAgentsRead
} from './mobile-session-read-operations'
import { isMobileMethodUnavailableError } from '../transport/mobile-method-unavailable'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { isFloatingWorkspaceWorktreeId } from './floating-workspace'
import { getRepoIdFromMobileWorktreeId } from './mobile-session-route-helpers'
import {
  buildMobileNewTabAgentOptions,
  type MobileNewTabAgentOption,
  type MobileNewTabAgentSettings
} from './mobile-new-tab-agent-options'

const WORKSPACE_ON_OTHER_RUNTIME_MESSAGE =
  'This workspace runs on another Orca server. Pair that server directly to see its agents.'

/** The paired host does not own this workspace, so its agents are unverifiable from here. */
export class MobileWorkspaceOnOtherRuntimeError extends Error {
  constructor() {
    super(WORKSPACE_ON_OTHER_RUNTIME_MESSAGE)
    this.name = 'MobileWorkspaceOnOtherRuntimeError'
  }
}

/** The host predates workspace-scoped detection, so its answer would be its own agents. */
export class MobileAgentDetectionNeedsHostUpdateError extends Error {
  constructor() {
    super("Update Orca on your computer to list this workspace's agents.")
    this.name = 'MobileAgentDetectionNeedsHostUpdateError'
  }
}

/** What a launch in this workspace can choose from: the host's settings, the agents detected on
 *  the workspace's execution host, and the workspace's repo (absent for the floating workspace). */
export type MobileAgentLaunchContext = {
  settings: unknown
  detectedAgents: unknown[]
  repo: MobileRuntimeRepoSummary | null
  /** The runtime that answered, so a later reuse can tell a re-paired server from this one. */
  runtimeId: string | null
}

export function hostRefusesOtherRuntimeWorkspace(
  hostCapabilities: readonly string[] | null | undefined
): boolean {
  return hostCapabilities?.includes(PREFLIGHT_OTHER_RUNTIME_REFUSAL_RUNTIME_CAPABILITY) === true
}

export function hostScopesAgentDetection(
  hostCapabilities: readonly string[] | null | undefined
): boolean {
  return hostCapabilities?.includes(PREFLIGHT_WORKSPACE_SCOPED_RUNTIME_CAPABILITY) === true
}

type MobileAgentLaunchContextArgs = {
  client: RpcClient
  worktreeId: string
  /** Whether the host refuses, rather than answers for, a workspace another runtime owns. */
  hostRefusesOtherRuntime?: boolean
  /** Whether the host detects on the workspace's own machine, rather than discarding the id. */
  hostScopesDetection?: boolean
  /** Re-reads the host's login-shell PATH before probing, as desktop's refresh does. */
  refresh?: boolean
}

export async function loadMobileAgentLaunchContext(
  args: MobileAgentLaunchContextArgs
): Promise<MobileAgentLaunchContext> {
  const { client, worktreeId } = args
  // Started before the settings read, not inside the array: the detection request goes on the wire
  // first, and the recorded sender order is what says so.
  const detectedAgentsRequest = loadDetectedAgents(client, worktreeId, args)
  const [settingsResponse, detectedAgents] = await Promise.all([
    newTabSettingsRead.request(client),
    detectedAgentsRequest
  ])
  const readSettings = newTabSettingsRead.interpret(settingsResponse)
  // Interpreted after the group, not inside it: whichever peer failed first must not decide the
  // error the sheet shows, and main raised the detection refusal only once settings had settled.
  const detected = interpretDetectedAgents(detectedAgents)
  return {
    settings: readSettings(),
    detectedAgents: detected,
    repo: detectedAgents.repo,
    runtimeId: settingsResponse._meta?.runtimeId ?? null
  }
}

/** The drawer's options and the detection they came from, which a later opening can reuse. */
export type MobileNewTabAgentInventory = Pick<
  MobileAgentLaunchContext,
  'detectedAgents' | 'runtimeId'
> & { options: MobileNewTabAgentOption[] }

export async function loadMobileNewTabAgentOptions(
  args: MobileAgentLaunchContextArgs & { settled?: MobileNewTabAgentInventory | null }
): Promise<MobileNewTabAgentInventory> {
  // Why settings every time: desktop reads them live, while a settled detection stands until refreshed.
  if (args.settled) {
    const reply = await newTabSettingsRead.request(args.client)
    const runtimeId = reply._meta?.runtimeId ?? null
    // Why a different runtime detects again: a server re-paired in place keeps its workspace ids.
    if (runtimeId === args.settled.runtimeId) {
      return newTabAgentInventory(newTabSettingsRead.interpret(reply)(), {
        ...args.settled,
        runtimeId
      })
    }
  }
  const context = await loadMobileAgentLaunchContext(args)
  return newTabAgentInventory(context.settings, context)
}

function newTabAgentInventory(
  settings: unknown,
  detection: Pick<MobileAgentLaunchContext, 'detectedAgents' | 'runtimeId'>
): MobileNewTabAgentInventory {
  return {
    options: buildMobileNewTabAgentOptions(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Preserve the established response shape at this boundary.
      settings as MobileNewTabAgentSettings | undefined,
      detection.detectedAgents
    ),
    detectedAgents: detection.detectedAgents,
    runtimeId: detection.runtimeId
  }
}

/** The reply and the operation that reads it: two methods detect agents and each reads its own. */
type DetectedAgentsReply = {
  reply: RpcResponse
  interpret: (reply: RpcResponse) => unknown[]
  repo: MobileRuntimeRepoSummary | null
}

async function loadDetectedAgents(
  client: RpcClient,
  worktreeId: string,
  host: Pick<
    MobileAgentLaunchContextArgs,
    'hostRefusesOtherRuntime' | 'hostScopesDetection' | 'refresh'
  >
): Promise<DetectedAgentsReply> {
  // Why: the floating workspace runs on the paired host, so it has no repo connection to resolve.
  if (isFloatingWorkspaceWorktreeId(worktreeId)) {
    return { ...(await probeHostAgents(client, undefined, host.refresh)), repo: null }
  }
  // Why the host places it: a folder names no repo, and only the host knows its SSH or WSL home.
  if (worktreeId.startsWith('folder:')) {
    if (!host.hostScopesDetection) {
      throw new MobileAgentDetectionNeedsHostUpdateError()
    }
    return { ...(await probeHostAgents(client, { worktreeId }, host.refresh)), repo: null }
  }
  const repoResponse = await newTabRepoListRead.request(client)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Preserve the established response shape at this boundary.
  const repos = (newTabRepoListRead.interpret(repoResponse) as MobileRuntimeRepoSummary[]) ?? []
  const repoId = getRepoIdFromMobileWorktreeId(worktreeId)
  const repo = repos.find((candidate) => candidate.id === repoId)
  if (!repo) {
    throw new Error('worktree_repo_not_found')
  }
  // A prefix test, not parseExecutionHostId: importing execution-host here splits a web bundle chunk.
  const runtimeOwned = repos
    .filter((candidate) => candidate.id === repoId)
    .map((candidate) => candidate.executionHostId?.startsWith('runtime:') === true)
  if (runtimeOwned.includes(true)) {
    // Why: rows on several hosts can share a repo id, and then only a host that refuses another
    // runtime's workspace may decide; the first row's connection could name this host's SSH target.
    if (!host.hostRefusesOtherRuntime || !runtimeOwned.includes(false)) {
      throw new MobileWorkspaceOnOtherRuntimeError()
    }
    return { ...(await probeHostAgents(client, { worktreeId }, host.refresh)), repo }
  }
  const connectionId = repo.connectionId?.trim() || null
  return connectionId
    ? {
        reply: await preflightDetectRemoteAgentsRead.request(client, { connectionId }),
        interpret: preflightDetectRemoteAgentsRead.interpret,
        repo
      }
    : {
        // Why the workspace: the host resolves its project runtime (a WSL distro on Windows). An
        // older host discards the params and answers with its own default, as it always has.
        ...(await probeHostAgents(client, { worktreeId }, host.refresh)),
        repo
      }
}

/** Desktop's `refreshRuntimeDetectedAgents` call: refresh, and detect only where the host lacks it. */
async function probeHostAgents(
  client: RpcClient,
  params: { worktreeId: string } | undefined,
  refresh: boolean | undefined
): Promise<Omit<DetectedAgentsReply, 'repo'>> {
  if (refresh) {
    const reply = await (params
      ? preflightRefreshAgentsRead.request(client, params)
      : preflightRefreshAgentsRead.request(client))
    // Why only this refusal: retrying a disconnect or a host failure doubles the work for nothing.
    if (reply.ok || !isMobileMethodUnavailableError(reply.error.code, reply.error.message)) {
      return { reply, interpret: preflightRefreshAgentsRead.interpret }
    }
  }
  return {
    reply: await (params
      ? preflightDetectAgentsRead.request(client, params)
      : preflightDetectAgentsRead.request(client)),
    interpret: preflightDetectAgentsRead.interpret
  }
}

function interpretDetectedAgents(detected: DetectedAgentsReply): unknown[] {
  try {
    return detected.interpret(detected.reply)
  } catch (error) {
    // A host with the refusal answers it for a workspace another runtime owns.
    if (error instanceof Error && error.message === WORKSPACE_ON_OTHER_RUNTIME) {
      throw new MobileWorkspaceOnOtherRuntimeError()
    }
    throw error
  }
}
