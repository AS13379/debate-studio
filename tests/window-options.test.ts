import { describe, expect, it } from 'vitest'
import { createWindowOptions } from '../src/main/window-options'

describe('application startup window', () => {
  it('uses an isolated renderer without Node integration', () => {
    const options = createWindowOptions('/tmp/preload.js')

    expect(options.webPreferences).toMatchObject({
      preload: '/tmp/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    })
  })
})
