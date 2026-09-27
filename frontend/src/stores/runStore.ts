import { create } from 'zustand'
import type { SheetRun, SheetRunDraftInput, SheetRunFinalizeInput } from '../types/sheet-run'
import { db, plain } from '../utils/db'
import { calculateDeviation } from '../utils/stripe'

interface RunStore {
  sheetRuns: SheetRun[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadRuns: () => Promise<void>
  addRun: (input: SheetRunDraftInput) => Promise<SheetRun | null>
  finalizeRun: (id: number, input: SheetRunFinalizeInput, standardGap: number) => Promise<void>
  updateMeasuredGap: (id: number, measuredGap: number, standardGap: number) => Promise<void>
}

export const useRunStore = create<RunStore>((set, get) => ({
  sheetRuns: [],
  isLoading: false,
  loaded: false,
  error: null,
  loadRuns: async () => {
    if (get().loaded) return
    set({ isLoading: true, error: null })
    try {
      const sheetRuns = await db.sheetRuns.orderBy('runDate').reverse().toArray()
      set({ sheetRuns, isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '抄纸工序读取失败，请检查浏览器存储权限' })
    }
  },
  addRun: async (input) => {
    set({ error: null })
    try {
      const payload = plain({
        ...input,
        state: '待补' as const,
        dryMethod: null,
        grammage: null,
        measuredGap: null,
        deviation: null,
        schemaRev: 3,
      })
      const id = Number(await db.sheetRuns.add(payload))
      const created: SheetRun = { ...payload, id }
      set((state) => ({ sheetRuns: [created, ...state.sheetRuns] }))
      return created
    } catch {
      set({ error: '工序登记失败，请检查工序编号是否重复' })
      return null
    }
  },
  finalizeRun: async (id, input, standardGap) => {
    const deviation = calculateDeviation(input.measuredGap, standardGap)
    const changes = { ...plain(input), deviation, state: '正式' as const, schemaRev: 3 }
    try {
      await db.sheetRuns.update(id, changes)
      set((state) => ({
        sheetRuns: state.sheetRuns.map((run) => (run.id === id ? { ...run, ...changes } : run)),
        error: null,
      }))
    } catch {
      set({ error: '工序转正失败，请稍后重试' })
    }
  },
  updateMeasuredGap: async (id, measuredGap, standardGap) => {
    const deviation = calculateDeviation(measuredGap, standardGap)
    try {
      await db.sheetRuns.update(id, { measuredGap, deviation, schemaRev: 3 })
      set((state) => ({
        sheetRuns: state.sheetRuns.map((run) => (run.id === id ? { ...run, measuredGap, deviation, schemaRev: 3 } : run)),
        error: null,
      }))
    } catch {
      set({ error: '实测间距更新失败' })
    }
  },
}))
