export const STRIPE_DIRECTIONS = ['竖帘纹', '横帘纹'] as const
export type StripeDirection = (typeof STRIPE_DIRECTIONS)[number]

export const DRY_METHODS = ['火墙', '日晒'] as const
export type DryMethod = (typeof DRY_METHODS)[number]

export const RUN_STATUSES = ['待补', '转正'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

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
  status: RunStatus
  dryMethod: DryMethod | null
  grammage: number | null
  measuredGap: number | null
  deviation: number | null
  schemaRev?: number
}

/** 第一步暂存：只定纸帘、料批与日期，实测数据等纸干透后补齐 */
export type SheetRunDraftInput = Pick<
  SheetRun,
  'runNo' | 'mouldId' | 'batchId' | 'runDate' | 'operator' | 'stripeDirection' | 'dipCount' | 'stackHeight'
>

/** 第二步转正：补齐干燥方式、克重与实测间距 */
export interface SheetRunConfirmInput {
  dryMethod: DryMethod
  grammage: number
  measuredGap: number
}
