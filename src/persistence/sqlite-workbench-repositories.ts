import type { AssetFileRecord } from '../assets'
import type { ProviderPricing } from '../cost'
import type { ModelRoutingPolicy, ModelRoutingTask } from '../model-routing'
import { Database } from './database'
import type { PersistenceResult } from './errors'
import type {
  AssetFileRepository,
  ModelRoutingPolicyRepository,
  ProviderPricingRepository
} from './repositories'

interface RoutingRow {
  task: ModelRoutingTask
  model_profile_id: string
  created_at: string
  updated_at: string
}

interface PricingRow {
  id: string
  model_profile_id: string
  model_id: string
  input_price_per_million: number
  output_price_per_million: number
  currency: string
  updated_at: string
}

interface AssetFileRow {
  asset_id: string
  media_type: AssetFileRecord['mediaType']
  mime_type: string
  file_size: number
  page_count: number | null
  width: number | null
  height: number | null
  thumbnail_path: string | null
  analysis_status: AssetFileRecord['analysisStatus']
  analysis_model_profile_id: string | null
  created_at: string
  updated_at: string
}

export class SQLiteModelRoutingPolicyRepository implements ModelRoutingPolicyRepository {
  constructor(private readonly database: Database) {}

  findByTask(task: ModelRoutingTask): PersistenceResult<ModelRoutingPolicy | undefined> {
    const result = this.database.get<RoutingRow>(`${this.selectSql()} WHERE task = ?`, task)
    return result.ok ? { ok: true, value: result.value ? this.map(result.value) : undefined } : result
  }

  list(): PersistenceResult<ModelRoutingPolicy[]> {
    const result = this.database.all<RoutingRow>(`${this.selectSql()} ORDER BY task`)
    return result.ok ? { ok: true, value: result.value.map((row) => this.map(row)) } : result
  }

  save(policy: ModelRoutingPolicy): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO model_routing_policies (task, model_profile_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(task) DO UPDATE SET model_profile_id = excluded.model_profile_id, updated_at = excluded.updated_at`,
      policy.task, policy.modelProfileId, policy.createdAt, policy.updatedAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  delete(task: ModelRoutingTask): PersistenceResult<boolean> {
    const result = this.database.run('DELETE FROM model_routing_policies WHERE task = ?', task)
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  private selectSql(): string {
    return 'SELECT task, model_profile_id, created_at, updated_at FROM model_routing_policies'
  }

  private map(row: RoutingRow): ModelRoutingPolicy {
    return { task: row.task, modelProfileId: row.model_profile_id, createdAt: row.created_at, updatedAt: row.updated_at }
  }
}

export class SQLiteProviderPricingRepository implements ProviderPricingRepository {
  constructor(private readonly database: Database) {}

  findByModelProfile(modelProfileId: string): PersistenceResult<ProviderPricing | undefined> {
    const result = this.database.get<PricingRow>(`${this.selectSql()} WHERE model_profile_id = ?`, modelProfileId)
    return result.ok ? { ok: true, value: result.value ? this.map(result.value) : undefined } : result
  }

  list(): PersistenceResult<ProviderPricing[]> {
    const result = this.database.all<PricingRow>(`${this.selectSql()} ORDER BY model_id`)
    return result.ok ? { ok: true, value: result.value.map((row) => this.map(row)) } : result
  }

  save(pricing: ProviderPricing): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO provider_pricing
       (id, model_profile_id, model_id, input_price_per_million, output_price_per_million, currency, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(model_profile_id) DO UPDATE SET model_id = excluded.model_id,
         input_price_per_million = excluded.input_price_per_million,
         output_price_per_million = excluded.output_price_per_million,
         currency = excluded.currency, updated_at = excluded.updated_at`,
      pricing.id, pricing.modelProfileId, pricing.modelId, pricing.inputPricePerMillion,
      pricing.outputPricePerMillion, pricing.currency, pricing.updatedAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  delete(id: string): PersistenceResult<boolean> {
    const result = this.database.run('DELETE FROM provider_pricing WHERE id = ?', id)
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  private selectSql(): string {
    return `SELECT id, model_profile_id, model_id, input_price_per_million,
      output_price_per_million, currency, updated_at FROM provider_pricing`
  }

  private map(row: PricingRow): ProviderPricing {
    return {
      id: row.id,
      modelProfileId: row.model_profile_id,
      modelId: row.model_id,
      inputPricePerMillion: row.input_price_per_million,
      outputPricePerMillion: row.output_price_per_million,
      currency: row.currency,
      updatedAt: row.updated_at
    }
  }
}

export class SQLiteAssetFileRepository implements AssetFileRepository {
  constructor(private readonly database: Database) {}

  findByAssetId(assetId: string): PersistenceResult<AssetFileRecord | undefined> {
    const result = this.database.get<AssetFileRow>(`${this.selectSql()} WHERE asset_id = ?`, assetId)
    return result.ok ? { ok: true, value: result.value ? this.map(result.value) : undefined } : result
  }

  listByAssets(assetIds: string[]): PersistenceResult<AssetFileRecord[]> {
    if (assetIds.length === 0) return { ok: true, value: [] }
    const result = this.database.all<AssetFileRow>(
      `${this.selectSql()} WHERE asset_id IN (${assetIds.map(() => '?').join(', ')})`,
      ...assetIds
    )
    return result.ok ? { ok: true, value: result.value.map((row) => this.map(row)) } : result
  }

  save(record: AssetFileRecord): PersistenceResult<void> {
    const result = this.database.run(
      `INSERT INTO asset_files
       (asset_id, media_type, mime_type, file_size, page_count, width, height, thumbnail_path,
        analysis_status, analysis_model_profile_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET media_type = excluded.media_type, mime_type = excluded.mime_type,
         file_size = excluded.file_size, page_count = excluded.page_count, width = excluded.width,
         height = excluded.height, thumbnail_path = excluded.thumbnail_path,
         analysis_status = excluded.analysis_status, analysis_model_profile_id = excluded.analysis_model_profile_id,
         updated_at = excluded.updated_at`,
      record.assetId, record.mediaType, record.mimeType, record.fileSize, record.pageCount ?? null,
      record.width ?? null, record.height ?? null, record.thumbnailPath ?? null, record.analysisStatus,
      record.analysisModelProfileId ?? null, record.createdAt, record.updatedAt
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  updateAnalysis(assetId: string, status: AssetFileRecord['analysisStatus'], modelProfileId: string | undefined, updatedAt: string): PersistenceResult<boolean> {
    const result = this.database.run(
      'UPDATE asset_files SET analysis_status = ?, analysis_model_profile_id = ?, updated_at = ? WHERE asset_id = ?',
      status, modelProfileId ?? null, updatedAt, assetId
    )
    return result.ok ? { ok: true, value: Number(result.value.changes) > 0 } : result
  }

  private selectSql(): string {
    return `SELECT asset_id, media_type, mime_type, file_size, page_count, width, height,
      thumbnail_path, analysis_status, analysis_model_profile_id, created_at, updated_at FROM asset_files`
  }

  private map(row: AssetFileRow): AssetFileRecord {
    return {
      assetId: row.asset_id,
      mediaType: row.media_type,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      pageCount: row.page_count ?? undefined,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      thumbnailPath: row.thumbnail_path ?? undefined,
      analysisStatus: row.analysis_status,
      analysisModelProfileId: row.analysis_model_profile_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
