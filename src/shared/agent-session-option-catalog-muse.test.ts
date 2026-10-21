import { describe, expect, it } from 'vitest'
import { MUSE_SESSION_OPTION_CATALOG } from './agent-session-option-catalog-muse'

const effort = () => {
  const option = (MUSE_SESSION_OPTION_CATALOG.unknownModelOptions ?? []).find(
    (candidate) => candidate.id === 'effort'
  )
  if (!option) {
    throw new Error('Muse catalog must define an effort option')
  }
  return option
}

describe('muse session option catalog', () => {
  it('seeds no models: ids are account-scoped with no listing command', () => {
    expect(MUSE_SESSION_OPTION_CATALOG.models).toEqual([])
  })

  it('switches effort mid-session through the /effort slash command', () => {
    const midSession = effort().apply.midSession
    expect(midSession?.kind).toBe('command')
    if (midSession?.kind !== 'command') {
      throw new Error('Muse effort midSession must stay a slash command')
    }
    expect(midSession.build('low')).toBe('/effort low')
  })

  it('keeps launch args for worker starts', () => {
    expect(effort().apply.launchArgs?.('ultra')).toEqual(['--reasoning-effort', 'ultra'])
  })
})
