import type { ModelRoutingService, ModelRoutingTask } from '../model-routing'
import type { PersistenceContext } from '../persistence'
import type { DebateConfigurationApplication } from './debate-configuration-application'
import type { ModelRoutingPolicyDto, WorkbenchResultDto } from '../shared/workbench-dtos'

export class ModelRoutingApplication {
  constructor(
    private readonly persistence: PersistenceContext,
    private readonly service: ModelRoutingService,
    private readonly configuration: DebateConfigurationApplication
  ) {}

  async listPolicies(): Promise<WorkbenchResultDto<ModelRoutingPolicyDto[]>> {
    const policies = this.service.list()
    const output: ModelRoutingPolicyDto[] = []
    for (const policy of policies) output.push(await this.dto(policy.task, policy.modelProfileId, policy.updatedAt))
    return { ok: true, value: output }
  }

  async savePolicy(task: ModelRoutingTask, modelProfileId: string): Promise<WorkbenchResultDto<ModelRoutingPolicyDto>> {
    const result = this.service.save(task, modelProfileId)
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, value: await this.dto(task, modelProfileId, new Date().toISOString()) }
  }

  createDefaults(): WorkbenchResultDto<boolean> {
    this.service.createDefaults()
    return { ok: true, value: true }
  }

  private async dto(task: ModelRoutingTask, modelProfileId: string, updatedAt: string): Promise<ModelRoutingPolicyDto> {
    const profileResult = this.persistence.repositories.modelProfiles.findById(modelProfileId)
    if (!profileResult.ok || !profileResult.value) return { task, modelProfileId, ready: false, issueZh: 'ModelProfile 不存在', updatedAt }
    const connectionResult = this.persistence.repositories.providerConnections.findById(profileResult.value.connectionId)
    const connection = connectionResult.ok ? connectionResult.value : undefined
    const profiles = this.configuration.listModelProfiles()
    const connections = await this.configuration.listProviderConnections()
    return {
      task,
      modelProfileId,
      modelProfile: profiles.ok ? profiles.value.find((item) => item.id === modelProfileId) : undefined,
      providerConnection: connections.ok ? connections.value.find((item) => item.id === connection?.id) : undefined,
      ready: Boolean(connection?.enabled),
      issueZh: connection?.enabled ? undefined : '服务商连接不可用',
      updatedAt
    }
  }
}
