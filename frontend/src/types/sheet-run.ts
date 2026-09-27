export const STRIPE_DIRECTIONS = ['竖帘纹', '横帘纹'] as const
export type StripeDirection = (typeof STRIPE_DIRECTIONS)[number]

export const DRY_METHODS = ['火墙', '日晒'] as const
export type DryMethod = (typeof DRY_METHODS)[number]

export const RUN_STATES = ['待补', '正式'] as const
export type RunState = (typeof RUN_STATES)[number]

export interface SheetRun {
  id?: number
  runNo: string
  mouldId: number
  batchId: number
  runDate: string
  operator: string
  stripeDirection: StripeDirection
  dipCount: number
  stackHeight: number
  state: RunState
  dryMethod: DryMethod | null
  grammage: number | null
  measuredGap: number | null
  deviation: number | null
  schemaRev?: number
}

export type SheetRunDraftInput = Pick<
  SheetRun,
  'runNo' | 'mouldId' | 'batchId' | 'runDate' | 'operator' | 'stripeDirection' | 'dipCount' | 'stackHeight'
>

export interface SheetRunFinalizeInput {
  dryMethod: DryMethod
  grammage: number
  measuredGap: number
}
