import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StringValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { MemoryStore } from '../src/store.ts'
import {
  MEMORY_TOOL_DESCRIPTION,
  MEMORY_TOOL_PARAMETERS,
  dispatchMemoryTool,
  toMemoryToolArgs,
} from '../src/schema.ts'

let dir: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-memory-schema-'))
})

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

async function freshStore(): Promise<MemoryStore> {
  const s = new MemoryStore({ dir: dir as string, memoryCharLimit: 2200, userCharLimit: 1375 })
  await s.loadFromDisk()
  return s
}

describe('MEMORY_TOOL schema', () => {
  it('description and parameters expose the documented surface', () => {
    expect(MEMORY_TOOL_DESCRIPTION).toContain('operations')
    expect(MEMORY_TOOL_DESCRIPTION).toContain("TARGETS: 'user'")
    const target = MEMORY_TOOL_PARAMETERS['target'] as (StringValueSchemaSpec & { required?: true }) | undefined
    const action = MEMORY_TOOL_PARAMETERS['action'] as StringValueSchemaSpec | undefined
    expect(target?.required).toBe(true)
    expect(action?.enum).toEqual(['add', 'replace', 'remove'])
  })

  it('toMemoryToolArgs narrows unknown values and defaults target', () => {
    expect(toMemoryToolArgs({ target: 'user', action: 'add', content: 'x' }))
      .toEqual({ target: 'user', action: 'add', content: 'x' })
    // Missing/invalid target defaults to memory; garbage action drops out.
    expect(toMemoryToolArgs({ action: 'explode', old_text: 7 }))
      .toEqual({ target: 'memory' })
    // A string old_text survives narrowing; a string action passes through.
    expect(toMemoryToolArgs({ action: 'replace', target: 'memory', old_text: 'prior', content: 'next' }))
      .toEqual({ action: 'replace', target: 'memory', old_text: 'prior', content: 'next' })
    expect(toMemoryToolArgs({ target: 'memory', operations: [{ action: 'add', content: 'a' }] }))
      .toEqual({ target: 'memory', operations: [{ action: 'add', content: 'a' }] })
  })
})

describe('dispatchMemoryTool', () => {
  it('adds content through the single-op path', async () => {
    const store = await freshStore()
    const r = await dispatchMemoryTool(store, { target: 'memory', action: 'add', content: 'hello' })
    expect(r).toMatchObject({ success: true, message: 'Entry added.' })
  })

  it('rejects semantically overlapping additions and gives the model merge guidance', async () => {
    const store = await freshStore()
    await store.add('user', '观影偏好：喜欢有理解难度、线索需逐步拼合且观后值得回味的扑朔迷离叙事。')
    const result = await store.add('user', '观影偏好：喜欢具有理解难度、线索可反复拼合、观后值得回味的电影。')
    expect(result).toMatchObject({ success: false })
    expect(result.usage).toMatch(/^\d+\/1,375$/)
    expect(result.error).toContain('semantically overlaps')
    expect(store.entriesFor('user')).toHaveLength(1)
  })

  it('rejects semantically overlapping batch additions atomically', async () => {
    const store = await freshStore()
    await store.add('user', '观影偏好：喜欢有理解难度、线索需逐步拼合且观后值得回味的扑朔迷离叙事。')
    const result = await store.applyBatch('user', [
      { action: 'add', content: '观影偏好：喜欢具有理解难度、线索可反复拼合、观后值得回味的电影。' },
      { action: 'add', content: '其他独立偏好。' },
    ])
    expect(result.success).toBe(false)
    expect(result.error).toContain('semantically overlaps')
    expect(store.entriesFor('user')).toHaveLength(1)
  })

  it('rejects add without content with the upstream text', async () => {
    const store = await freshStore()
    for (const content of [undefined, '']) {
      const r = await dispatchMemoryTool(store, { target: 'memory', action: 'add', ...(content === undefined ? {} : { content }) })
      expect(r).toEqual({ success: false, error: "Content is required for 'add' action." })
    }
  })

  it('replace without old_text returns the recovery inventory error', async () => {
    const store = await freshStore()
    await store.add('memory', 'existing entry')
    const r = await dispatchMemoryTool(store, { target: 'memory', action: 'replace', content: 'new' })
    expect(r.success).toBe(false)
    expect(r.error).toContain("'replace' needs old_text")
    expect(r.current_entries).toEqual(['existing entry'])
    expect(r.usage).toBe('14/2,200')
  })

  it('replace with old_text but without content errors before acting', async () => {
    const store = await freshStore()
    await store.add('memory', 'existing')
    const r = await dispatchMemoryTool(store, { target: 'memory', action: 'replace', old_text: 'existing' })
    expect(r).toEqual({ success: false, error: "content is required for 'replace' action." })
  })

  it('remove without old_text returns the recovery inventory error', async () => {
    const store = await freshStore()
    const r = await dispatchMemoryTool(store, { target: 'memory', action: 'remove' })
    expect(r.success).toBe(false)
    expect(r.error).toContain("'remove' needs old_text")
    expect(r.current_entries).toEqual([])
  })

  it('routes to replace and remove on the single-op path', async () => {
    const store = await freshStore()
    await store.add('memory', 'first fact')
    expect(await dispatchMemoryTool(store, { target: 'memory', action: 'replace', old_text: 'first', content: 'second fact' }))
      .toMatchObject({ success: true, message: 'Entry replaced.' })
    expect(await dispatchMemoryTool(store, { target: 'memory', action: 'remove', old_text: 'second fact' }))
      .toMatchObject({ success: true, message: 'Entry removed.' })
  })

  it('an empty operations list falls through to the unknown-action error', async () => {
    // Upstream truthiness: `if operations:` is falsy for [], so the batch path
    // is skipped and the call lands in the single-op unknown-action branch.
    const store = await freshStore()
    const r = await dispatchMemoryTool(store, { target: 'memory', operations: [] })
    expect(r).toEqual({ success: false, error: "Unknown action ''. Use: add, replace, remove" })
  })

  it('a non-empty operations list wins over single-op fields', async () => {
    const store = await freshStore()
    const r = await dispatchMemoryTool(store, {
      target: 'memory',
      action: 'add',
      content: 'ignored',
      operations: [{ action: 'add', content: 'batch entry' }],
    })
    expect(r).toMatchObject({ success: true, message: 'Applied 1 operation(s).' })
    expect(store.entriesFor('memory')).toEqual(['batch entry'])
  })

  it('unknown actions produce the usage error', async () => {
    const store = await freshStore()
    const r = await dispatchMemoryTool(store, { target: 'memory' })
    expect(r).toEqual({ success: false, error: "Unknown action ''. Use: add, replace, remove" })
  })

  it('writes to the user target', async () => {
    const store = await freshStore()
    const r = await dispatchMemoryTool(store, { target: 'user', action: 'add', content: 'Name: Kim' })
    expect(r).toMatchObject({ success: true, target: 'user' })
  })
})
