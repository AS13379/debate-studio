import { z } from 'zod'

const idSchema = z.string().trim().min(1).max(200)
const optionalIdSchema = idSchema.optional()
const protocolSchema = z.enum([
  'mock',
  'openai-chat',
  'openai-responses',
  'gemini-native',
  'dashscope-native',
  'mimo-native'
])

export const modelCapabilitiesSchema = z.object({
  textInput: z.boolean(),
  imageInput: z.boolean(),
  documentInput: z.boolean(),
  audioInput: z.boolean(),
  videoInput: z.boolean(),
  streaming: z.boolean(),
  reasoning: z.boolean(),
  toolCalling: z.boolean(),
  webSearch: z.boolean(),
  structuredOutput: z.boolean()
}).strict()

export const saveProviderConnectionSchema = z.object({
  id: optionalIdSchema,
  providerId: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(200),
  protocolType: protocolSchema,
  baseUrl: z.string().trim().url(),
  enabled: z.boolean()
}).strict()

export const saveModelProfileSchema = z.object({
  id: optionalIdSchema,
  connectionId: idSchema,
  modelId: z.string().trim().min(1).max(300),
  displayName: z.string().trim().min(1).max(200),
  alias: z.string().trim().max(200).optional(),
  capabilities: modelCapabilitiesSchema,
  contextWindow: z.number().int().positive().max(10_000_000).optional(),
  maxOutputTokens: z.number().int().positive().max(10_000_000).optional()
}).strict()

export const createDebateSchema = z.object({
  topic: z.string().trim().min(1).max(1_000),
  background: z.string().trim().max(20_000).optional(),
  affirmativePosition: z.string().trim().min(1).max(5_000),
  negativePosition: z.string().trim().min(1).max(5_000),
  freeDebateRounds: z.number().int().min(1).max(20)
}).strict()

const participantBindingSchema = z.object({
  modelProfileId: idSchema,
  displayName: z.string().trim().min(1).max(200),
  systemPromptTemplate: z.string().trim().max(20_000).optional()
}).strict()

export const saveParticipantBindingsSchema = z.object({
  sessionId: idSchema,
  affirmative: participantBindingSchema,
  negative: participantBindingSchema,
  moderator: participantBindingSchema,
  judge: participantBindingSchema.optional()
}).strict()

export const idInputSchema = z.object({ id: idSchema }).strict()
export const historyListQuerySchema = z.object({
  search: z.string().trim().max(500).optional(),
  sort: z.enum(['created-desc', 'created-asc', 'updated-desc', 'updated-asc']).optional(),
  favoriteOnly: z.boolean().optional(),
  tag: z.string().trim().max(50).optional(),
  status: z.enum(['active', 'archived', 'deleted', 'all']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(1_000_000).optional()
}).strict().default({})
export const debateTurnPageSchema = z.object({
  sessionId: idSchema,
  limit: z.number().int().min(1).max(100).optional(),
  before: z.object({ createdAt: z.string().datetime(), id: idSchema }).strict().optional()
}).strict()
export const renameDebateSchema = z.object({
  id: idSchema,
  customTitle: z.string().trim().min(1).max(200)
}).strict()
export const toggleFavoriteSchema = z.object({ id: idSchema, favorite: z.boolean() }).strict()
export const debateTagSchema = z.object({ id: idSchema, tag: z.string().trim().min(1).max(50) }).strict()
export const deleteDebateSchema = z.object({ id: idSchema, confirmed: z.boolean() }).strict()
export const deleteProviderConnectionSchema = z.object({
  id: idSchema,
  deleteCredential: z.boolean()
}).strict()
export const sessionInputSchema = z.object({ sessionId: idSchema }).strict()
export const credentialInputSchema = z.object({
  connectionId: idSchema,
  credential: z.string().min(1).max(16_384)
}).strict()
export const connectionInputSchema = z.object({ connectionId: idSchema }).strict()
export const connectionTestInputSchema = z.object({
  connectionId: idSchema,
  modelProfileId: idSchema.optional()
}).strict()

const researchVisibilitySchema = z.enum([
  'public', 'affirmative-private', 'negative-private', 'moderator-private'
])

const researchAssetBase = {
  sessionId: idSchema,
  ownerParticipantId: idSchema,
  visibility: researchVisibilitySchema,
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().max(20_000).optional()
}

export const addResearchAssetSchema = z.discriminatedUnion('kind', [
  z.object({
    ...researchAssetBase,
    kind: z.literal('text'),
    textContent: z.string().trim().min(1).max(200_000)
  }).strict(),
  z.object({
    ...researchAssetBase,
    kind: z.literal('url'),
    url: z.string().trim().url().max(4_000)
  }).strict(),
  z.object({
    ...researchAssetBase,
    kind: z.literal('image'),
    fileName: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().regex(/^image\//).max(100),
    bytes: z.array(z.number().int().min(0).max(255)).min(1).max(10 * 1024 * 1024)
  }).strict()
])

export const publishEvidenceSchema = z.object({
  sessionId: idSchema, assetId: idSchema, changedBy: idSchema
}).strict()

export const updateEvidenceStatusSchema = z.object({
  sessionId: idSchema,
  evidenceId: idSchema,
  status: z.enum(['unverified', 'supported', 'disputed', 'outdated', 'inaccessible', 'misleading', 'rejected']),
  changedBy: idSchema,
  note: z.string().trim().max(10_000)
}).strict()

export const challengeEvidenceSchema = z.object({
  sessionId: idSchema, evidenceId: idSchema, changedBy: idSchema,
  note: z.string().trim().max(10_000)
}).strict()

export const runMockSearchSchema = z.object({
  sessionId: idSchema, ownerParticipantId: idSchema,
  query: z.string().trim().min(1).max(2_000)
}).strict()

export const saveSearchProviderConnectionSchema = z.object({
  id: optionalIdSchema,
  displayName: z.string().trim().min(1).max(200),
  baseUrl: z.string().trim().url().max(2_000),
  enabled: z.boolean(),
  isDefault: z.boolean()
}).strict()

export const searchCredentialInputSchema = z.object({
  connectionId: idSchema,
  credential: z.string().min(1).max(16_384)
}).strict()

export const researchRuntimeSettingsSchema = z.object({
  mode: z.enum(['automatic', 'step-confirmation']),
  limits: z.object({
    maxToolCalls: z.number().int().min(1).max(50),
    maxSearches: z.number().int().min(0).max(20),
    maxPageReads: z.number().int().min(0).max(20),
    maxBodyCharacters: z.number().int().min(1_000).max(500_000)
  }).strict()
}).strict()

export const researchToolDecisionSchema = z.object({
  callId: idSchema,
  approved: z.boolean()
}).strict()

export const rendererErrorSchema = z.object({
  title: z.string().trim().min(1).max(200),
  userMessage: z.string().trim().min(1).max(500),
  technicalMessage: z.string().trim().max(1_000).optional(),
  source: z.string().trim().min(1).max(100)
}).strict()

export const rendererPerformanceSchema = z.object({
  durationMs: z.number().finite().min(0).max(60_000),
  source: z.string().trim().min(1).max(100)
}).strict()

export const exportDebateSchema = z.object({
  debateId: idSchema,
  exportOptions: z.object({
    includePrivateResearch: z.boolean()
  }).strict()
}).strict()

export const deleteExportSchema = z.object({ exportId: idSchema }).strict()
export const cancelExportSchema = z.object({ exportId: idSchema }).strict()
