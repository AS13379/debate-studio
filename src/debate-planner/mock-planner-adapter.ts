import { MockAdapter } from '../providers'
import type { DebatePlan } from './types'

export class MockPlannerAdapter extends MockAdapter {
  constructor(plan: Omit<DebatePlan, 'topic'>) {
    super({ plannerResponse: JSON.stringify(plan) })
  }
}
