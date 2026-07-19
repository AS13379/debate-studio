import {
  ModelAdapterError,
  type ModelAdapter,
  type UnifiedError,
  type UnifiedRequest,
  type UnifiedResponse,
  type UnifiedStreamEvent
} from './model-adapter'

export interface MockAdapterOptions {
  responseText?: string
  chunks?: string[]
  reasoningChunks?: string[]
  delayMs?: number
  error?: {
    message?: string
    atChunk?: number
  }
  plannerResponse?: string
  evaluationResponse?: string
  reviewResponse?: string
}

export class MockAdapter implements ModelAdapter {
  private readonly chunks: string[]
  private readonly reasoningChunks: string[]
  private readonly delayMs: number
  private readonly simulatedError?: MockAdapterOptions['error']
  private readonly plannerResponse?: string
  private readonly evaluationResponse?: string
  private readonly reviewResponse?: string

  constructor(options: MockAdapterOptions = {}) {
    this.chunks = options.chunks ?? [options.responseText ?? '[Mock] 模拟模型发言']
    this.reasoningChunks = options.reasoningChunks ?? []
    this.delayMs = options.delayMs ?? 0
    this.simulatedError = options.error
    this.plannerResponse = options.plannerResponse
    this.evaluationResponse = options.evaluationResponse
    this.reviewResponse = options.reviewResponse
  }

  async complete(request: UnifiedRequest): Promise<UnifiedResponse> {
    let response: UnifiedResponse | undefined
    for await (const event of this.stream(request)) {
      if (event.type === 'error') throw new ModelAdapterError(event.error)
      if (event.type === 'completed') response = event.response
    }

    if (!response) {
      throw new ModelAdapterError({ code: 'EMPTY_RESPONSE', message: 'Mock adapter returned no response.', retryable: true })
    }
    return response
  }

  async *stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent> {
    yield { type: 'started', requestId: request.requestId }

    if (this.simulatedError && this.simulatedError.atChunk === undefined) {
      yield this.errorEvent(request, this.simulatedError?.message)
      return
    }

    let content = ''
    let reasoningContent = ''
    const chunks = request.runtimeMetadata.purpose === 'debate-planning'
      ? [this.plannerResponse ?? mockPlanResponse(request.topic)]
      : request.runtimeMetadata.purpose === 'debate-evaluation'
        ? [this.evaluationResponse ?? mockEvaluationResponse()]
        : request.runtimeMetadata.purpose === 'debate-review'
          ? [this.reviewResponse ?? mockReviewResponse()]
          : this.chunks
    for (const chunk of this.reasoningChunks) {
      if (request.signal.aborted || (await this.waitForDelay(request.signal))) {
        yield this.cancelledEvent(request)
        return
      }
      reasoningContent += chunk
      yield { type: 'reasoningDelta', requestId: request.requestId, delta: chunk }
    }

    for (const [index, chunk] of chunks.entries()) {
      if (request.signal.aborted || (await this.waitForDelay(request.signal))) {
        yield this.cancelledEvent(request)
        return
      }
      if (this.simulatedError?.atChunk === index) {
        yield this.errorEvent(request, this.simulatedError.message)
        return
      }

      content += chunk
      yield { type: 'textDelta', requestId: request.requestId, delta: chunk }
    }

    if (request.signal.aborted) {
      yield this.cancelledEvent(request)
      return
    }

    yield {
      type: 'completed',
      response: {
        requestId: request.requestId,
        content,
        finishReason: 'stop',
        ...(reasoningContent ? { reasoningContent } : {})
      }
    }
  }

  private async waitForDelay(signal: AbortSignal): Promise<boolean> {
    if (this.delayMs <= 0) return signal.aborted

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve(false)
      }, this.delayMs)
      const onAbort = (): void => {
        clearTimeout(timeout)
        resolve(true)
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private errorEvent(request: UnifiedRequest, message = 'Mock request failed.'): UnifiedStreamEvent {
    const error: UnifiedError = { code: 'REQUEST_FAILED', message, retryable: true }
    return { type: 'error', requestId: request.requestId, error }
  }

  private cancelledEvent(request: UnifiedRequest): UnifiedStreamEvent {
    return {
      type: 'error',
      requestId: request.requestId,
      error: { code: 'CANCELLED', message: 'Mock request was cancelled.', retryable: true }
    }
  }
}

export class MockJudgeAdapter extends MockAdapter {
  constructor(options: Pick<MockAdapterOptions, 'evaluationResponse' | 'reviewResponse' | 'delayMs' | 'error'> = {}) {
    super(options)
  }
}

function mockPlanResponse(topic: string): string {
  return JSON.stringify({
    background: `围绕“${topic}”界定讨论范围、适用条件与评价标准。`,
    affirmativePosition: `正方主张“${topic}”成立，并将从可行性、收益与长期影响展开论证。`,
    negativePosition: `反方主张“${topic}”不成立或条件不足，并将从风险、代价与替代方案展开论证。`,
    keyQuestions: ['核心概念应如何界定？', '主要收益与代价分别由谁承担？', '在什么条件下结论可能发生变化？'],
    researchDirections: ['查找权威定义与适用边界', '比较支持和反对立场的实证材料', '识别典型案例与反例'],
    evidenceSuggestions: ['官方统计或政策文件', '同行评审研究', '可核验的现实案例']
  })
}

function mockEvaluationResponse(): string {
  const side = (offset: number) => ({
    logicalCompleteness: { score: 7.5 + offset, reason: '论点与结论之间的关联基本完整。' },
    evidenceQuality: { score: 7 + offset, reason: '公开证据能支持主要主张，但仍有补强空间。' },
    rebuttalEffectiveness: { score: 7.2 + offset, reason: '能回应对方核心论点。' },
    factualAccuracy: { score: 8 + offset, reason: '未发现与已公开证据直接冲突的表述。' },
    argumentDepth: { score: 7.4 + offset, reason: '论证考虑了条件和影响。' },
    clarity: { score: 8.1 + offset, reason: '表达简洁，核心主张可识别。' }
  })
  return JSON.stringify({
    winner: 'affirmative', scores: { affirmative: side(0.4), negative: side(0) },
    strengths: { affirmative: ['主线论证连贯'], negative: ['能指出实施风险'] },
    weaknesses: { affirmative: ['部分证据的适用边界可更明确'], negative: ['对核心证据回应不足'] },
    keyTurningPoints: ['正方在反驳阶段将证据与主张重新连接。'],
    evidenceUsage: { affirmative: '有效使用公开证据支持主线。', negative: '使用了证据，但未完全回应对方核心材料。' },
    reasoningQuality: { affirmative: '前提、证据与结论的关联较清晰。', negative: '风险分析有效，但替代方案论证偏短。' }
  })
}

function mockReviewResponse(): string {
  return JSON.stringify({
    summary: '正方依靠连贯的证据主线小幅占优，反方对实施风险的提醒仍有价值。',
    bestArguments: ['正方将核心主张与公开证据连接。'],
    bestRebuttals: ['反驳阶段直接回应了成本与可行性质疑。'],
    missedOpportunities: ['反方没有继续追问核心证据的适用边界。'],
    evidenceAnalysis: ['已发布证据发挥了作用，但仍需区分因果关系与相关性。'],
    improvementSuggestions: ['下次应在总结阶段明确回收对方尚未回应的证据。']
  })
}
