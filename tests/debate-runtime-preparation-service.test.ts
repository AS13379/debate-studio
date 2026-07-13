import { describe, expect, it } from 'vitest'

import { AdapterRegistry } from '../src/providers'
import {
  DebateRuntimePreparationService,
  type DebateRuntimePreparationDependencies
} from '../src/runtime'
import type { DebateSetupLoadResult, LoadedDebateSetup } from '../src/setup-loading'

const validationError = {
  code: 'MISSING_AFFIRMATIVE' as const,
  titleZh: '正方模型未配置',
  descriptionZh: '缺少正方角色。',
  role: 'affirmative' as const,
  suggestedActionZh: '请配置正方模型。'
}

function invalidLoadResult(): DebateSetupLoadResult {
  return {
    setup: undefined,
    validation: { valid: false, errors: [validationError], warnings: [] },
    loadErrors: []
  }
}

describe('DebateRuntimePreparationService', () => {
  it('does not resolve runtime or create TurnRunner when validation fails', () => {
    let resolverCalls = 0
    let factoryCalls = 0
    const dependencies: DebateRuntimePreparationDependencies = {
      loader: { load: () => invalidLoadResult() },
      resolver: {
        resolve: () => {
          resolverCalls += 1
          throw new Error('resolver must not run')
        }
      },
      turnRunnerFactory: {
        create: () => {
          factoryCalls += 1
          throw new Error('factory must not run')
        }
      },
      adapterRegistry: new AdapterRegistry()
    }

    const result = new DebateRuntimePreparationService(dependencies).prepare('invalid-session')

    expect(result).toEqual({
      ok: false,
      loadErrors: [],
      validationErrors: [validationError],
      runtimeErrors: [],
      warnings: []
    })
    expect(resolverCalls).toBe(0)
    expect(factoryCalls).toBe(0)
  })

  it('preserves structured load errors without creating a Runner', () => {
    let factoryCalls = 0
    const loadError = {
      code: 'REPOSITORY_READ_FAILED' as const,
      titleZh: '读取 Session 失败',
      descriptionZh: '仓储读取失败。',
      relatedId: 'session-load-error',
      retryable: true
    }
    const service = new DebateRuntimePreparationService({
      loader: {
        load: () => ({
          setup: undefined,
          validation: { valid: false, errors: [], warnings: [] },
          loadErrors: [loadError]
        })
      },
      resolver: { resolve: () => { throw new Error('resolver must not run') } },
      turnRunnerFactory: {
        create: () => {
          factoryCalls += 1
          throw new Error('factory must not run')
        }
      },
      adapterRegistry: new AdapterRegistry()
    })

    const result = service.prepare('session-load-error')

    expect(result).toMatchObject({ ok: false, loadErrors: [loadError] })
    expect(factoryCalls).toBe(0)
  })

  it('preserves RuntimeResolver errors without creating a Runner', () => {
    let factoryCalls = 0
    const setup = {
      session: {
        id: 'runtime-error-session',
        debateId: 'runtime-error-debate',
        status: 'draft',
        currentStage: 'draft',
        createdAt: '2026-07-13T00:00:00.000Z',
        updatedAt: '2026-07-13T00:00:00.000Z'
      },
      modelProfiles: [],
      providerConnections: [],
      availableProtocolTypes: []
    } as LoadedDebateSetup
    const runtimeError = {
      code: 'ADAPTER_UNAVAILABLE' as const,
      titleZh: '协议适配器不可用',
      descriptionZh: '没有已注册的 Adapter。',
      role: 'affirmative' as const,
      retryable: false
    }
    const service = new DebateRuntimePreparationService({
      loader: {
        load: () => ({
          setup,
          validation: { valid: true, errors: [], warnings: [] },
          loadErrors: []
        })
      },
      resolver: { resolve: () => ({ ok: false, errors: [runtimeError] }) },
      turnRunnerFactory: {
        create: () => {
          factoryCalls += 1
          throw new Error('factory must not run')
        }
      },
      adapterRegistry: new AdapterRegistry()
    })

    const result = service.prepare(setup.session.id)

    expect(result).toEqual({
      ok: false,
      loadErrors: [],
      validationErrors: [],
      runtimeErrors: [runtimeError],
      warnings: []
    })
    expect(factoryCalls).toBe(0)
  })
})
