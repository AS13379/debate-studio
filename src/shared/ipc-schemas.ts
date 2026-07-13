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
