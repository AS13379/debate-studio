import { execFile } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createInstallHelperScript, createInstallTerminalLauncherScript } from '../src/main/community-update-platform'

const execFileAsync = promisify(execFile)
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('community update install helper', () => {
  it('retries launching until the new app confirms startup, then removes the backup', async () => {
    const fixture = await createFixture(true)
    await execFileAsync('/bin/zsh', [fixture.helper, '99999999', fixture.currentApp, fixture.stagedApp, fixture.cache, '0.5.4'])

    expect(await readFile(join(fixture.currentApp, 'version.txt'), 'utf8')).toBe('new')
    await expect(access(`${fixture.currentApp}.community-update-backup`)).rejects.toThrow()
    expect(Number(await readFile(fixture.attempts, 'utf8'))).toBeGreaterThanOrEqual(2)
    expect(await readFile(join(fixture.cache, 'install-last.log'), 'utf8')).toContain('更新成功：Debate Studio v0.5.4 已启动')
  })

  it('restores the previous app and clears stale pending state when startup is never confirmed', async () => {
    const fixture = await createFixture(false)
    await expect(execFileAsync('/bin/zsh', [fixture.helper, '99999999', fixture.currentApp, fixture.stagedApp, fixture.cache, '0.5.4'])).rejects.toThrow()

    expect(await readFile(join(fixture.currentApp, 'version.txt'), 'utf8')).toBe('old')
    await expect(access(`${fixture.currentApp}.community-update-backup`)).rejects.toThrow()
    await expect(access(join(fixture.cache, 'install-pending.json'))).rejects.toThrow()
    expect(JSON.parse(await readFile(join(fixture.cache, 'install-result.json'), 'utf8'))).toMatchObject({ status: 'rolled-back', version: '0.5.4', detailCode: 'UPDATE_STARTUP_CONFIRMATION_TIMEOUT' })
    const log = await readFile(join(fixture.cache, 'install-last.log'), 'utf8')
    expect(log).toContain('正在恢复旧版本')
    expect(log).toContain('UPDATE_STARTUP_CONFIRMATION_TIMEOUT')
  })

  it('can render the same installation progress in English', async () => {
    const fixture = await createFixture(true)
    await execFileAsync('/bin/zsh', [fixture.helper, '99999999', fixture.currentApp, fixture.stagedApp, fixture.cache, '0.5.5'], {
      env: { ...process.env, DEBATE_UPDATE_LANGUAGE: 'en' }
    })

    const log = await readFile(join(fixture.cache, 'install-last.log'), 'utf8')
    expect(log).toContain('Starting installation of Debate Studio v0.5.5.')
    expect(log).toContain('Update succeeded: Debate Studio v0.5.5 is running')
  })

  it('quotes every path in the Terminal launcher without changing arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'debate-studio-launcher-'))
    roots.push(root)
    const helper = join(root, "helper's script.sh")
    const launcher = join(root, 'install-update.command')
    const captured = join(root, 'captured.json')
    await writeFile(helper, `#!/bin/zsh\nnode -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' '${captured}' "$@"\n`, { mode: 0o700 })
    const expected = ['/Applications/Debate Studio.app', join(root, "stage's app"), join(root, 'cache folder'), '0.5.5']
    await writeFile(launcher, createInstallTerminalLauncherScript({
      helperPath: helper,
      parentPid: 42,
      appPath: expected[0],
      stagedApp: expected[1],
      cacheDirectory: expected[2],
      version: expected[3]
    }), { mode: 0o700 })

    await execFileAsync('/bin/zsh', [launcher])
    expect(JSON.parse(await readFile(captured, 'utf8'))).toEqual(['42', ...expected])
  })
})

async function createFixture(confirmOnRetry: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'debate-studio-updater-'))
  roots.push(root)
  const currentApp = join(root, 'Debate Studio.app')
  const stagedApp = join(root, 'staging', 'Debate Studio.app')
  const cache = join(root, 'cache')
  const helper = join(cache, 'install-update.sh')
  const openShim = join(root, 'open-shim.sh')
  const attempts = join(root, 'launch-attempts.txt')
  await Promise.all([mkdir(currentApp, { recursive: true }), mkdir(stagedApp, { recursive: true }), mkdir(cache, { recursive: true })])
  await Promise.all([
    writeFile(join(currentApp, 'version.txt'), 'old'),
    writeFile(join(stagedApp, 'version.txt'), 'new'),
    writeFile(join(cache, 'install-pending.json'), JSON.stringify({ version: '0.5.4' })),
    writeFile(join(cache, 'install-result.json'), JSON.stringify({ status: 'rolled-back', version: 'stale' })),
    writeFile(attempts, '0')
  ])
  const shim = `#!/bin/sh
COUNT=$(cat '${attempts}')
COUNT=$((COUNT+1))
printf '%s' "$COUNT" > '${attempts}'
${confirmOnRetry ? `if [ "$COUNT" -ge 2 ]; then printf '{}' > '${join(cache, 'launch-confirmed.json')}'; fi` : ':'}
exit 0
`
  await writeFile(openShim, shim, { mode: 0o700 })
  await chmod(openShim, 0o700)
  await writeFile(helper, createInstallHelperScript({
    openCommand: openShim,
    sleepSeconds: 0.01,
    parentWaitIterations: 2,
    confirmationWaitIterations: 8,
    retryEveryIterations: 2,
    settleSeconds: 0,
    languageSelectionSeconds: 0,
    successCloseSeconds: 0
  }), { mode: 0o700 })
  await chmod(helper, 0o700)
  return { root, currentApp, stagedApp, cache, helper, attempts }
}
