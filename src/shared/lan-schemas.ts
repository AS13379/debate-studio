import { z } from 'zod'

export const lanLoginSchema = z.object({
  password: z.string().min(1).max(256),
  deviceName: z.string().trim().min(1).max(60).optional()
}).strict()

export const lanDebateListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  sort: z.enum(['created-desc', 'created-asc', 'updated-desc', 'updated-asc']).optional(),
  status: z.enum(['active', 'archived', 'deleted', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(51).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional()
}).strict()

export const lanIdSchema = z.object({ id: z.string().trim().min(1).max(200) }).strict()
export const lanSessionParamsSchema = z.object({ sessionId: z.string().trim().min(1).max(200) }).strict()

export const lanSnapshotQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(80).optional(),
  beforeCreatedAt: z.string().datetime().optional(),
  beforeId: z.string().trim().min(1).max(200).optional()
}).strict().refine((value) => Boolean(value.beforeCreatedAt) === Boolean(value.beforeId), {
  message: 'beforeCreatedAt and beforeId must be provided together.'
})

export const lanCommandSchema = z.object({
  command: z.enum(['start', 'pause', 'resume', 'stop'])
}).strict()

export const lanConfigUpdateSchema = z.object({
  port: z.number().int().min(1024).max(65535).optional(),
  sessionTimeoutMinutes: z.number().int().min(15).max(10_080).optional(),
  autoPort: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one setting is required.')

export const lanPasswordSchema = z.object({ password: z.string().min(10).max(256) }).strict()
export const lanDeviceSchema = z.object({ deviceId: z.string().uuid() }).strict()
