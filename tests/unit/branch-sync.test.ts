import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('main to editor-preview branch synchronization', () => {
  it('merges main into editor-preview and refreshes the Pages preview', () => {
    const source = read('.github/workflows/sync-editor-preview.yml')
    const workflow = parse(source)
    const steps = workflow.jobs.sync.steps as Array<{
      name?: string
      uses?: string
      run?: string
      env?: Record<string, string>
      with?: Record<string, unknown>
    }>

    expect(workflow.on.push.branches).toEqual(['main'])
    expect(workflow.on.workflow_dispatch).toEqual({})
    expect(workflow.permissions).toEqual({ contents: 'write', actions: 'write' })
    expect(workflow.concurrency).toEqual({
      group: 'sync-editor-preview',
      'cancel-in-progress': false,
    })

    expect(steps).toContainEqual(
      expect.objectContaining({
        uses: 'actions/checkout@v4',
        with: expect.objectContaining({ ref: 'editor-preview', 'fetch-depth': 0 }),
      }),
    )

    const mergeStepIndex = steps.findIndex((step) => step.run?.includes('git merge --no-edit origin/main'))
    const pushStepIndex = steps.findIndex((step) => step.run?.includes('git push origin HEAD:editor-preview'))
    const dispatchStepIndex = steps.findIndex((step) => step.run?.includes('gh workflow run pages-preview.yml'))
    const commands = steps.map((step) => step.run ?? '').join('\n')

    expect(mergeStepIndex).toBeGreaterThanOrEqual(0)
    expect(pushStepIndex).toBeGreaterThanOrEqual(mergeStepIndex)
    expect(dispatchStepIndex).toBeGreaterThan(pushStepIndex)
    expect(steps[dispatchStepIndex].env).toEqual({ GH_TOKEN: '${{ github.token }}' })
    expect(commands).toContain('git fetch origin main')
    expect(commands).toContain('git merge --no-edit origin/main')
    expect(commands).toContain('git push origin HEAD:editor-preview')
    expect(commands).toContain('gh workflow run pages-preview.yml --ref editor-preview')
    expect(commands).not.toMatch(/force|reset --hard/i)
  })
})
