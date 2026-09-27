import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { ProcessTimeline, type ProcessStep } from '../components/common/ProcessTimeline'
import { RulerInput } from '../components/common/RulerInput'
import { useUnitConvert } from '../hooks/useUnitConvert'
import { useFiberStore } from '../stores/fiberStore'
import { useMouldStore } from '../stores/mouldStore'
import { useRunStore } from '../stores/runStore'
import { DRY_METHODS, STRIPE_DIRECTIONS, type DryMethod, type SheetRun, type SheetRunDraftInput, type SheetRunFinalizeInput, type StripeDirection } from '../types/sheet-run'
import { calculateDeviation, getGapConclusion, isGapOutOfTolerance } from '../utils/stripe'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const emptyRunForm: SheetRunDraftInput = {
  runNo: '',
  mouldId: 1,
  batchId: 1,
  runDate: todayIso(),
  operator: '罗青禾',
  stripeDirection: '竖帘纹',
  dipCount: 2,
  stackHeight: 42,
}

const emptyFinalizeForm: SheetRunFinalizeInput = {
  dryMethod: '火墙',
  grammage: 32,
  measuredGap: 1,
}

const processSteps: ProcessStep[] = [
  { label: '浆料复核', detail: '核对料批打浆度与漂洗状态。', status: 'done' },
  { label: '帘床就位', detail: '确认纸帘方向与框架张力。', status: 'done' },
  { label: '入槽抄纸', detail: '按设定次数完成荡料与提帘。', status: 'active' },
  { label: '压榨定形', detail: '控制叠高后转火墙或日晒。', status: 'pending' },
  { label: '量纹偏差', detail: '实测间距并与纸帘标准值比较。', status: 'pending' },
]

function stepsForLatestRun(run: SheetRun | undefined): ProcessStep[] {
  if (!run) return processSteps
  if (run.state === '待补') {
    return [
      { label: '浆料复核', detail: '核对料批打浆度与漂洗状态。', status: 'done' },
      { label: '帘床就位', detail: '确认纸帘方向与框架张力。', status: 'done' },
      { label: '入槽抄纸', detail: '按设定次数完成荡料与提帘。', status: 'done' },
      { label: '压榨定形', detail: '等待纸页干透后补测数据。', status: 'active' },
      { label: '量纹偏差', detail: '补齐实测间距、克重与干燥方式后转正。', status: 'pending' },
    ]
  }
  return processSteps.map((step) => ({ ...step, status: 'done' as const }))
}

export default function RunBoard() {
  const runs = useRunStore((state) => state.sheetRuns)
  const runError = useRunStore((state) => state.error)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const addRun = useRunStore((state) => state.addRun)
  const finalizeRun = useRunStore((state) => state.finalizeRun)
  const updateMeasuredGap = useRunStore((state) => state.updateMeasuredGap)
  const moulds = useMouldStore((state) => state.moulds)
  const mouldError = useMouldStore((state) => state.error)
  const loadMoulds = useMouldStore((state) => state.loadMoulds)
  const batches = useFiberStore((state) => state.fiberBatches)
  const batchError = useFiberStore((state) => state.error)
  const loadBatches = useFiberStore((state) => state.loadFiberBatches)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<SheetRunDraftInput>(emptyRunForm)
  const [dateFilter, setDateFilter] = useState('')
  const [mouldFilter, setMouldFilter] = useState('全部')
  const [draftGaps, setDraftGaps] = useState<Record<number, number>>({})
  const [finalizeTarget, setFinalizeTarget] = useState<SheetRun | null>(null)
  const [finalizeForm, setFinalizeForm] = useState<SheetRunFinalizeInput>(emptyFinalizeForm)
  const [submitting, setSubmitting] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const { formatGrammage, cmToMm } = useUnitConvert()

  useEffect(() => {
    void loadRuns()
    void loadMoulds()
    void loadBatches()
  }, [loadBatches, loadMoulds, loadRuns])

  const mouldById = useMemo(() => new Map(moulds.map((mould) => [mould.id, mould])), [moulds])
  const batchById = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches])
  const filteredRuns = useMemo(
    () => runs.filter((run) => {
      const mould = mouldById.get(run.mouldId)
      const matchesDate = !dateFilter || run.runDate === dateFilter
      const matchesMould = mouldFilter === '全部' || mould?.mouldNo === mouldFilter
      return matchesDate && matchesMould
    }),
    [dateFilter, mouldById, mouldFilter, runs],
  )
  const latestRun = runs[0]
  const timelineSteps = useMemo(() => stepsForLatestRun(latestRun), [latestRun])
  const finalizeMould = finalizeTarget ? mouldById.get(finalizeTarget.mouldId) : undefined
  const finalizeStandardGap = finalizeMould?.stripeGap ?? finalizeForm.measuredGap
  const finalizeDeviation = calculateDeviation(finalizeForm.measuredGap, finalizeStandardGap)

  const updateForm = <K extends keyof SheetRunDraftInput,>(key: K, value: SheetRunDraftInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!form.runNo.trim() || !form.operator.trim()) return
    setSubmitting(true)
    const created = await addRun({ ...form, runNo: form.runNo.trim(), operator: form.operator.trim() })
    setSubmitting(false)
    if (created) {
      setForm(emptyRunForm)
      setShowForm(false)
    }
  }

  const openFinalize = (run: SheetRun) => {
    const mould = mouldById.get(run.mouldId)
    setFinalizeForm({ dryMethod: '火墙', grammage: 32, measuredGap: mould?.stripeGap ?? 1 })
    setFinalizeTarget(run)
  }

  const handleFinalize = async () => {
    if (!finalizeTarget || finalizeTarget.id === undefined) return
    if (finalizeForm.grammage <= 0 || finalizeForm.measuredGap <= 0) return
    setFinalizing(true)
    await finalizeRun(finalizeTarget.id, finalizeForm, finalizeStandardGap)
    setFinalizing(false)
    setFinalizeTarget(null)
  }

  const error = runError ?? mouldError ?? batchError

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography component="h1" variant="h3" color="#344a34">抄纸工序记录台</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>关联纸帘与料批，记录抄纸参数，并在行内复测帘纹间距。</Typography>
        </Box>
        <Button variant="contained" size="large" onClick={() => setShowForm((current) => !current)} data-testid="new-run">
          {showForm ? '收起登记' : '新建工序'}
        </Button>
      </Box>

      {error && <Alert severity="warning">{error}</Alert>}

      {showForm && (
        <Card data-testid="form-run" sx={{ borderColor: '#9eb096' }}>
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="h5">登记抄纸工序</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                先定纸帘、料批与日期，保存为待补槽，暂不计入本周工序也不判偏差；实测间距、克重与干燥方式待纸干透后补齐转正。
              </Typography>
            </Box>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}><TextField fullWidth label="工序编号" value={form.runNo} onChange={(event) => updateForm('runNo', event.target.value)} inputProps={{ 'data-testid': 'field-runNo' }} /></Grid>
              <Grid item xs={6} md={2.5}>
                <TextField select fullWidth label="纸帘" value={form.mouldId} onChange={(event) => updateForm('mouldId', Number(event.target.value))} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-mouldId' } }}>
                  {!moulds.some((mould) => mould.id === form.mouldId) && <option value={form.mouldId}>纸帘数据载入中</option>}
                  {moulds.filter((mould) => mould.state !== '退役').map((mould) => <option key={mould.id} value={mould.id}>{mould.mouldNo} · {mould.stripeGap} mm</option>)}
                </TextField>
              </Grid>
              <Grid item xs={6} md={2.5}>
                <TextField select fullWidth label="纤维料批" value={form.batchId} onChange={(event) => updateForm('batchId', Number(event.target.value))} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-batchId' } }}>
                  {!batches.some((batch) => batch.id === form.batchId) && <option value={form.batchId}>料批数据载入中</option>}
                  {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.batchNo} · {batch.material}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={12} md={2}><TextField fullWidth type="date" label="抄纸日期" value={form.runDate} onChange={(event) => updateForm('runDate', event.target.value)} InputLabelProps={{ shrink: true }} inputProps={{ 'data-testid': 'field-runDate' }} /></Grid>
              <Grid item xs={12} md={2}><TextField fullWidth label="操作人" value={form.operator} onChange={(event) => updateForm('operator', event.target.value)} inputProps={{ 'data-testid': 'field-operator' }} /></Grid>
              <Grid item xs={6} md={2}>
                <TextField select fullWidth label="帘纹方向" value={form.stripeDirection} onChange={(event) => updateForm('stripeDirection', event.target.value as StripeDirection)} SelectProps={{ native: true, inputProps: { 'data-testid': 'field-stripeDirection' } }}>
                  {STRIPE_DIRECTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </TextField>
              </Grid>
              <Grid item xs={6} md={2}><TextField fullWidth type="number" label="荡料次数" value={form.dipCount} onChange={(event) => updateForm('dipCount', Number(event.target.value))} inputProps={{ min: 1, max: 8, step: 1, 'data-testid': 'field-dipCount' }} /></Grid>
              <Grid item xs={6} md={2}><TextField fullWidth type="number" label="叠高" value={form.stackHeight} onChange={(event) => updateForm('stackHeight', Number(event.target.value))} inputProps={{ min: 10, max: 120, step: 1, 'data-testid': 'field-stackHeight' }} InputProps={{ endAdornment: '张' }} /></Grid>
            </Grid>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 2.5 }}>
              <Button onClick={() => setShowForm(false)}>取消</Button>
              <Button variant="contained" onClick={handleSubmit} disabled={submitting} data-testid="submit-run">保存待补工序</Button>
            </Box>
          </CardContent>
        </Card>
      )}

      <Grid container spacing={2.5}>
        <Grid item xs={12} lg={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>最近一槽的工序进程</Typography>
              {latestRun ? (
                <>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                    <Chip size="small" label={latestRun.runNo} />
                    <Chip size="small" color={latestRun.state === '待补' ? 'warning' : 'success'} variant="outlined" label={latestRun.state === '待补' ? '待补' : '已转正'} />
                    <Chip size="small" variant="outlined" label={latestRun.grammage != null ? formatGrammage(latestRun.grammage) : '克重待补'} />
                  </Box>
                  <ProcessTimeline steps={timelineSteps} compact />
                </>
              ) : (
                <Typography color="text.secondary">等待工序数据。</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} lg={8}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
              <Grid container spacing={1.5} alignItems="center">
                <Grid item xs={12} sm={5} md={4}><TextField fullWidth size="small" type="date" label="按日期筛选" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} InputLabelProps={{ shrink: true }} /></Grid>
                <Grid item xs={8} sm={5} md={4}>
                  <TextField select fullWidth size="small" label="按帘号筛选" value={mouldFilter} onChange={(event) => setMouldFilter(event.target.value)} SelectProps={{ native: true }}>
                    <option value="全部">全部纸帘</option>
                    {moulds.map((mould) => <option key={mould.id} value={mould.mouldNo}>{mould.mouldNo}</option>)}
                  </TextField>
                </Grid>
                <Grid item xs={4} md={2}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">记录数</Typography>
                    <Typography variant="h5" data-testid="count-run">{filteredRuns.length}</Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={2}><Button fullWidth variant="outlined" onClick={() => { setDateFilter(''); setMouldFilter('全部') }}>重置</Button></Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <TableContainer component={Card}>
        <Table sx={{ minWidth: 1080 }}>
          <TableHead>
            <TableRow>
              <TableCell>工序 / 日期</TableCell>
              <TableCell>纸帘与料批</TableCell>
              <TableCell>抄纸参数</TableCell>
              <TableCell align="right">克重</TableCell>
              <TableCell>实测间距与偏差</TableCell>
              <TableCell align="right">保存实测</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredRuns.map((run) => {
              const mould = mouldById.get(run.mouldId)
              const batch = batchById.get(run.batchId)
              const isPending = run.state === '待补'
              const draftGap = run.id === undefined ? (run.measuredGap ?? 0) : draftGaps[run.id] ?? run.measuredGap ?? mould?.stripeGap ?? 1
              const draftDeviation = calculateDeviation(draftGap, mould?.stripeGap ?? draftGap)
              const exceeded = !isPending && isGapOutOfTolerance(draftDeviation)
              return (
                <TableRow key={run.id ?? run.runNo} data-testid="row-run" hover sx={{ bgcolor: exceeded ? '#fff7d9' : undefined }}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Typography sx={{ fontWeight: 750 }}>{run.runNo}</Typography>
                      <Chip size="small" color={isPending ? 'warning' : 'success'} variant={isPending ? 'filled' : 'outlined'} label={isPending ? '待补' : '已转正'} />
                    </Box>
                    <Typography variant="caption" color="text.secondary">{run.runDate} · {run.operator}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{mould?.mouldNo ?? '未关联纸帘'}</Typography>
                    <Typography variant="caption" color="text.secondary">{batch?.batchNo ?? '未关联料批'} · {batch?.material ?? '待补'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{run.stripeDirection} · 荡料 {run.dipCount} 次</Typography>
                    <Typography variant="caption" color="text.secondary">叠高 {run.stackHeight} 张 · {run.dryMethod ?? '干燥待补'} · 帘框 {cmToMm(mould?.frameW ?? 0)} × {cmToMm(mould?.frameH ?? 0)} mm</Typography>
                  </TableCell>
                  <TableCell align="right">
                    {run.grammage != null ? `${run.grammage} g/m²` : <Typography component="span" variant="body2" color="text.secondary">待补</Typography>}
                  </TableCell>
                  <TableCell sx={{ minWidth: 270 }}>
                    {isPending ? (
                      <Typography variant="caption" color="text.secondary">
                        纸干透后补测间距与克重，转正时按纸帘标准 {mould?.stripeGap ?? '—'} mm 判定 ±0.2 mm 偏差。
                      </Typography>
                    ) : (
                      <RulerInput
                        label="帘纹间距"
                        value={draftGap}
                        onChange={(value) => {
                          if (run.id !== undefined) setDraftGaps((current) => ({ ...current, [run.id as number]: value }))
                        }}
                        min={0.1}
                        max={5}
                        step={0.01}
                        testId={run.id === undefined ? undefined : `row-measuredGap-${run.id}`}
                        helperText={<Typography component="span" variant="caption" color={exceeded ? 'warning.dark' : 'text.secondary'}>{exceeded ? '超差：' : '合格：'}{getGapConclusion(draftDeviation)}（{draftDeviation > 0 ? '+' : ''}{draftDeviation.toFixed(2)} mm）</Typography>}
                        compact
                      />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {isPending ? (
                      <Button
                        size="small"
                        variant="contained"
                        color="warning"
                        disabled={run.id === undefined}
                        onClick={() => openFinalize(run)}
                        data-testid={run.id === undefined ? undefined : `row-finalize-${run.id}`}
                      >
                        补齐转正
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant={exceeded ? 'contained' : 'outlined'}
                        color={exceeded ? 'warning' : 'primary'}
                        disabled={run.id === undefined || draftGap === run.measuredGap}
                        onClick={() => {
                          if (run.id !== undefined) void updateMeasuredGap(run.id, draftGap, mould?.stripeGap ?? draftGap)
                        }}
                      >
                        {draftGap === run.measuredGap ? '已记录' : '保存实测'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {filteredRuns.length === 0 && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5 }}>没有符合日期与帘号条件的工序</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={finalizeTarget !== null} onClose={() => setFinalizeTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>补齐实测并转正{finalizeTarget ? ` · ${finalizeTarget.runNo}` : ''}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }} data-testid="form-finalize">
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
              <Typography variant="body2" color="text.secondary">
                按纸帘 {finalizeMould?.mouldNo ?? '未关联'} 的标准间距 {finalizeStandardGap.toFixed(2)} mm 重算偏差，超差 ±0.2 mm 将在记录台标黄。
              </Typography>
              <Chip color={isGapOutOfTolerance(finalizeDeviation) ? 'warning' : 'success'} label={`偏差 ${finalizeDeviation > 0 ? '+' : ''}${finalizeDeviation.toFixed(2)} mm`} />
            </Box>
            <TextField
              select
              fullWidth
              label="干燥方式"
              value={finalizeForm.dryMethod}
              onChange={(event) => setFinalizeForm((current) => ({ ...current, dryMethod: event.target.value as DryMethod }))}
              SelectProps={{ native: true, inputProps: { 'data-testid': 'field-finalize-dryMethod' } }}
            >
              {DRY_METHODS.map((option) => <option key={option} value={option}>{option}</option>)}
            </TextField>
            <TextField
              fullWidth
              type="number"
              label="克重"
              value={finalizeForm.grammage}
              onChange={(event) => setFinalizeForm((current) => ({ ...current, grammage: Number(event.target.value) }))}
              inputProps={{ min: 10, max: 200, step: 1, 'data-testid': 'field-finalize-grammage' }}
              InputProps={{ endAdornment: 'g/m²' }}
            />
            <RulerInput
              label="实测帘纹间距"
              value={finalizeForm.measuredGap}
              onChange={(value) => setFinalizeForm((current) => ({ ...current, measuredGap: value }))}
              min={0.1}
              max={5}
              step={0.01}
              testId="field-finalize-measuredGap"
              helperText={`${getGapConclusion(finalizeDeviation)}，允许偏差 ±0.2 mm`}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFinalizeTarget(null)}>取消</Button>
          <Button variant="contained" onClick={handleFinalize} disabled={finalizing} data-testid="submit-finalize">转正工序</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
