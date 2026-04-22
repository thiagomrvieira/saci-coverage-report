import {
  CoverageReport,
  FileMetrics,
  Metrics,
  MethodInfo,
  percentage,
  delta,
} from './types'

interface FormatterOptions {
  showAbsoluteNumbers: boolean
  withChart: boolean
  crapThreshold: number
  topCrapLimit: number
  onlyChangedFiles: boolean
  signature: string
  commitSha: string
  baseReport: CoverageReport | null
  changedFiles: string[]
}

function fmt(covered: number, total: number, showAbsolute: boolean): string {
  const pct = percentage(covered, total)
  if (showAbsolute && total > 0) {
    return `${pct}% (${covered}/${total})`
  }
  return `${pct}%`
}

function deltaStr(currentPct: number, basePct: number): string {
  const d = delta(currentPct, basePct)
  if (d > 0) return `:chart_with_upwards_trend: +${d}%`
  if (d < 0) return `:warning: ${d}%`
  return `:heavy_minus_sign: 0%`
}

function summaryTable(
  current: Metrics,
  base: Metrics | null,
  showAbsolute: boolean,
): string {
  const rows: string[] = []

  const metrics: {
    label: string
    covered: keyof Metrics
    total: keyof Metrics
  }[] = [
    {label: 'Lines', covered: 'coveredStatements', total: 'statements'},
    {label: 'Methods', covered: 'coveredMethods', total: 'methods'},
    {
      label: 'Branches',
      covered: 'coveredConditionals',
      total: 'conditionals',
    },
    {label: 'Classes', covered: 'coveredClasses', total: 'classes'},
  ]

  if (base) {
    rows.push('| Metric | Current | Base | Delta |')
    rows.push('|--------|---------|------|-------|')
    for (const m of metrics) {
      const curVal = current[m.covered] as number
      const curTotal = current[m.total] as number
      const baseVal = base[m.covered] as number
      const baseTotal = base[m.total] as number
      const curPct = percentage(curVal, curTotal)
      const basePct = percentage(baseVal, baseTotal)
      rows.push(
        `| ${m.label} | ${fmt(curVal, curTotal, showAbsolute)} | ${fmt(baseVal, baseTotal, showAbsolute)} | ${deltaStr(curPct, basePct)} |`,
      )
    }
  } else {
    rows.push('| Metric | Coverage |')
    rows.push('|--------|----------|')
    for (const m of metrics) {
      const curVal = current[m.covered] as number
      const curTotal = current[m.total] as number
      rows.push(
        `| ${m.label} | ${fmt(curVal, curTotal, showAbsolute)} |`,
      )
    }
  }

  return rows.join('\n')
}

function groupByDirectory(
  files: FileMetrics[],
): Map<string, FileMetrics[]> {
  const groups = new Map<string, FileMetrics[]>()

  for (const f of files) {
    const lastSlash = f.displayPath.lastIndexOf('/')
    const dir = lastSlash >= 0 ? f.displayPath.substring(0, lastSlash) : '.'
    if (!groups.has(dir)) groups.set(dir, [])
    groups.get(dir)!.push(f)
  }

  return groups
}

function fileName(displayPath: string): string {
  const lastSlash = displayPath.lastIndexOf('/')
  return lastSlash >= 0 ? displayPath.substring(lastSlash + 1) : displayPath
}

function isDirAffected(dir: string, changedFiles: string[]): boolean {
  if (changedFiles.length === 0) return true
  return changedFiles.some((f) => f.startsWith(dir + '/') || f === dir)
}

function dirSummaryMetrics(
  dirFiles: FileMetrics[],
  showAbsolute: boolean,
): string {
  let totalStmts = 0
  let coveredStmts = 0
  for (const f of dirFiles) {
    totalStmts += f.metrics.statements
    coveredStmts += f.metrics.coveredStatements
  }
  return fmt(coveredStmts, totalStmts, showAbsolute)
}

function buildDirTable(
  dirFiles: FileMetrics[],
  baseFiles: Map<string, FileMetrics> | null,
  showAbsolute: boolean,
  hasDelta: boolean,
): string {
  dirFiles.sort((a, b) => {
    const aPct = percentage(a.metrics.coveredStatements, a.metrics.statements)
    const bPct = percentage(b.metrics.coveredStatements, b.metrics.statements)
    return aPct - bPct
  })

  const rows: string[] = []

  if (hasDelta) {
    rows.push('| File | Lines | Methods | Branches | CRAP | Delta |')
    rows.push('|------|-------|---------|----------|------|-------|')
  } else {
    rows.push('| File | Lines | Methods | Branches | CRAP |')
    rows.push('|------|-------|---------|----------|------|')
  }

  for (const f of dirFiles) {
    const name = fileName(f.displayPath)
    const lines = fmt(f.metrics.coveredStatements, f.metrics.statements, showAbsolute)
    const methods = fmt(f.metrics.coveredMethods, f.metrics.methods, showAbsolute)
    const branches = fmt(f.metrics.coveredConditionals, f.metrics.conditionals, showAbsolute)
    const crap = f.averageCrap > 0 ? f.averageCrap.toString() : '-'

    if (hasDelta) {
      const baseFile = baseFiles!.get(f.displayPath)
      let deltaCol: string
      if (baseFile) {
        const curPct = percentage(f.metrics.coveredStatements, f.metrics.statements)
        const basePct = percentage(baseFile.metrics.coveredStatements, baseFile.metrics.statements)
        deltaCol = deltaStr(curPct, basePct)
      } else {
        deltaCol = ':sparkles: new'
      }
      rows.push(`| ${name} | ${lines} | ${methods} | ${branches} | ${crap} | ${deltaCol} |`)
    } else {
      rows.push(`| ${name} | ${lines} | ${methods} | ${branches} | ${crap} |`)
    }
  }

  return rows.join('\n')
}

function fileTable(
  files: FileMetrics[],
  baseFiles: Map<string, FileMetrics> | null,
  showAbsolute: boolean,
  onlyChanged: boolean,
  changedFiles: string[],
): string {
  let filteredFiles = files.filter(
    (f) => f.metrics.statements > 0 || f.metrics.methods > 0,
  )

  if (onlyChanged && baseFiles) {
    filteredFiles = filteredFiles.filter((f) => {
      const baseFile = baseFiles.get(f.displayPath)
      if (!baseFile) return true
      const curLine = percentage(f.metrics.coveredStatements, f.metrics.statements)
      const baseLine = percentage(baseFile.metrics.coveredStatements, baseFile.metrics.statements)
      return Math.abs(curLine - baseLine) >= 0.01
    })
  }

  if (filteredFiles.length === 0) {
    return '_No files with coverable lines._'
  }

  const hasDelta = baseFiles !== null
  const groups = groupByDirectory(filteredFiles)
  const sortedDirs = Array.from(groups.keys()).sort()

  const sections: string[] = []

  for (const dir of sortedDirs) {
    const dirFiles = groups.get(dir)!
    const affected = isDirAffected(dir, changedFiles)
    const openAttr = affected ? ' open' : ''
    const dirCoverage = dirSummaryMetrics(dirFiles, showAbsolute)
    const fileCount = dirFiles.length

    const table = buildDirTable(dirFiles, baseFiles, showAbsolute, hasDelta)

    sections.push(
      `<details${openAttr}>\n<summary><b>${dir}</b> — ${dirCoverage} (${fileCount} files)</summary>\n\n${table}\n\n</details>`,
    )
  }

  return sections.join('\n\n')
}

function topCrapTable(
  methods: MethodInfo[],
  threshold: number,
  limit: number,
): string {
  const risky = methods
    .filter((m) => m.crap >= threshold)
    .sort((a, b) => b.crap - a.crap)
    .slice(0, limit)

  if (risky.length === 0) return ''

  const rows: string[] = [
    '',
    `#### :rotating_light: Top CRAP Methods (threshold: ${threshold})`,
    '',
    '| Method | CRAP | Coverage | Complexity |',
    '|--------|------|----------|------------|',
  ]

  for (const m of risky) {
    const coverage = percentage(m.coveredLines, m.lineCount)
    rows.push(
      `| ${m.className}::${m.name} | ${m.crap} | ${coverage}% | ${m.complexity} |`,
    )
  }

  return rows.join('\n')
}

function distributionChart(files: FileMetrics[]): string {
  const buckets = new Array(11).fill(0)
  let totalFiles = 0

  for (const f of files) {
    if (f.metrics.statements === 0) continue
    totalFiles++
    const pct = percentage(f.metrics.coveredStatements, f.metrics.statements)
    const bucket = Math.min(Math.floor(pct / 10), 10)
    buckets[bucket]++
  }

  if (totalFiles === 0) return ''

  const maxFreq = Math.max(...buckets)
  const barWidth = 20

  const rows: string[] = ['', '#### Coverage Distribution', '', '```']
  rows.push(
    'Cover ' +
      '\u250c' +
      '\u2500'.repeat(barWidth + 2) +
      '\u2510' +
      ' Freq.',
  )

  for (let i = 0; i <= 10; i++) {
    const label = `${(i * 10).toString().padStart(3)}%`
    const freq = totalFiles > 0 ? (buckets[i] / totalFiles) * 100 : 0
    const filled = maxFreq > 0 ? Math.round((buckets[i] / maxFreq) * barWidth) : 0
    const bar =
      '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled)
    rows.push(
      `${label} \u2502 ${bar} \u2502 ${freq.toFixed(1)}%`,
    )
  }

  rows.push(
    '     ' +
      ' \u2514' +
      '\u2500'.repeat(barWidth + 2) +
      '\u2518',
  )
  rows.push('```')

  return rows.join('\n')
}

export function formatReport(
  current: CoverageReport,
  options: FormatterOptions,
): string {
  const parts: string[] = []

  const shortSha = options.commitSha
    ? options.commitSha.substring(0, 7)
    : 'unknown'
  parts.push(`### Coverage Report for \`${shortSha}\``)
  parts.push('')

  parts.push(
    summaryTable(
      current.projectMetrics,
      options.baseReport?.projectMetrics || null,
      options.showAbsoluteNumbers,
    ),
  )

  parts.push('')
  parts.push('#### Files')
  parts.push('')

  const baseFileMap = options.baseReport
    ? new Map(options.baseReport.files.map((f) => [f.displayPath, f]))
    : null

  parts.push(
    fileTable(
      current.files,
      baseFileMap,
      options.showAbsoluteNumbers,
      options.onlyChangedFiles,
      options.changedFiles,
    ),
  )

  const crapSection = topCrapTable(
    current.allMethods,
    options.crapThreshold,
    options.topCrapLimit,
  )
  if (crapSection) parts.push(crapSection)

  if (options.withChart) {
    parts.push(distributionChart(current.files))
  }

  parts.push('')
  parts.push(`---`)
  parts.push(
    `<sub>${options.signature}</sub>`,
  )

  return parts.join('\n')
}
