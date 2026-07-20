const SLOW_MODEL_PATTERNS = [
  /reasoner/i,
  /thinking/i,
  /deep[-_]?research/i,
  /kimi-k3/i,
  /(?:^|[/_-])glm-5(?:\.\d+)?(?:[-_/]|$)/i,
  /(?:^|[-_])o[134](?:[-_]|$)/i,
  /pro-preview/i
]

export function isSlowFirstTokenModel(modelId: string): boolean {
  return SLOW_MODEL_PATTERNS.some((pattern) => pattern.test(modelId))
}

export function slowModelNotice(modelId: string): string | undefined {
  return isSlowFirstTokenModel(modelId)
    ? `${modelId} 属于长思考或高推理模型，首段文字可能需要等待较长时间；只要运行状态仍在更新，就不是空转。`
    : undefined
}
