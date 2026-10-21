import { describe, expect, it, vi } from 'vitest'
import {
  readTerminalAutoRestoreFitMs,
  saveTerminalAutoRestoreFitMs,
  setTerminalAutoRestoreFitMsForHost
} from './terminal-auto-restore-fit-state'

describe('terminal auto restore fit state', () => {
  it('reads the saved delay out of the host reply envelope, after a read and after a save', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ id: '1', ok: true, result: { ms: 1_000 } })
      .mockResolvedValueOnce({ id: '2', ok: true, result: { ms: 60_000 } })

    await expect(readTerminalAutoRestoreFitMs({ sendRequest })).resolves.toBe(1_000)
    await expect(saveTerminalAutoRestoreFitMs({ sendRequest }, 60_000)).resolves.toBe(60_000)
    expect(sendRequest).toHaveBeenLastCalledWith('terminal.setAutoRestoreFit', { ms: 60_000 })
  })

  it('returns the existing state object when a host value is unchanged', () => {
    const current = { hostA: 60_000, hostB: null }

    expect(setTerminalAutoRestoreFitMsForHost(current, 'hostA', 60_000)).toBe(current)
    expect(setTerminalAutoRestoreFitMsForHost(current, 'hostB', null)).toBe(current)
  })

  it('updates one host while preserving other host values', () => {
    const current = { hostA: 60_000, hostB: null }
    const next = setTerminalAutoRestoreFitMsForHost(current, 'hostA', 300_000)

    expect(next).not.toBe(current)
    expect(next).toEqual({ hostA: 300_000, hostB: null })
  })
})
