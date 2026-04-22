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
  repoUrl: string
}

const BAR_WIDTH = 8
const CHAR_FILLED = '\u2588'
const CHAR_EMPTY = '\u2591'

function bar(pct: number): string {
  const filled = Math.round((pct / 100) * BAR_WIDTH)
  return CHAR_FILLED.repeat(filled) + CHAR_EMPTY.repeat(BAR_WIDTH - filled)
}

function coverageLabel(pct: number): string {
  if (pct >= 80) return 'high'
  if (pct >= 50) return 'mid'
  return 'low'
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
  if (d > 0) return `**+${d}%**`
  if (d === 0) return `\u2014`
  if (d > -5) return `${d}%`
  return `**${d}%**`
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
    {label: 'Branches', covered: 'coveredConditionals', total: 'conditionals'},
    {label: 'Classes', covered: 'coveredClasses', total: 'classes'},
  ]

  if (base) {
    rows.push('| Metric | Coverage | | Base | Delta |')
    rows.push('|--------|-------:|---|-----:|------:|')
    for (const m of metrics) {
      const curVal = current[m.covered] as number
      const curTotal = current[m.total] as number
      const baseVal = base[m.covered] as number
      const baseTotal = base[m.total] as number
      const curPct = percentage(curVal, curTotal)
      const basePct = percentage(baseVal, baseTotal)
      rows.push(
        `| **${m.label}** | ${fmt(curVal, curTotal, showAbsolute)} | \`${bar(curPct)}\` | ${fmt(baseVal, baseTotal, showAbsolute)} | ${deltaStr(curPct, basePct)} |`,
      )
    }
  } else {
    rows.push('| Metric | Coverage | |')
    rows.push('|--------|-------:|---|')
    for (const m of metrics) {
      const curVal = current[m.covered] as number
      const curTotal = current[m.total] as number
      const curPct = percentage(curVal, curTotal)
      rows.push(
        `| **${m.label}** | ${fmt(curVal, curTotal, showAbsolute)} | \`${bar(curPct)}\` |`,
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

function countChangedInDir(dir: string, dirFiles: FileMetrics[], changedFiles: string[]): number {
  if (changedFiles.length === 0) return 0
  return dirFiles.filter((f) => changedFiles.some((cf) => cf === f.displayPath)).length
}

function isFileChanged(displayPath: string, changedFiles: string[]): boolean {
  return changedFiles.some((cf) => cf === displayPath)
}

function dirSummary(
  dir: string,
  dirFiles: FileMetrics[],
  showAbsolute: boolean,
  affected: boolean,
  changedCount: number,
): string {
  let totalStmts = 0
  let coveredStmts = 0
  for (const f of dirFiles) {
    totalStmts += f.metrics.statements
    coveredStmts += f.metrics.coveredStatements
  }
  const pct = percentage(coveredStmts, totalStmts)
  const coverage = showAbsolute && totalStmts > 0
    ? `${pct}% (${coveredStmts}/${totalStmts})`
    : `${pct}%`
  const changedSuffix = affected && changedCount > 0
    ? ` \u2014 ${changedCount} file${changedCount > 1 ? 's' : ''} changed`
    : ''
  return `<b>${dir}</b> <code>${bar(pct)}</code> ${coverage} \u00B7 ${dirFiles.length} files${changedSuffix}`
}

function fileLink(displayPath: string, repoUrl: string): string {
  const name = fileName(displayPath)
  if (!repoUrl) return `\`${name}\``
  return `[\`${name}\`](${repoUrl}/${displayPath} "${displayPath}")`
}

function buildDirTable(
  dirFiles: FileMetrics[],
  baseFiles: Map<string, FileMetrics> | null,
  showAbsolute: boolean,
  hasDelta: boolean,
  repoUrl: string,
  changedFiles: string[],
): string {
  dirFiles.sort((a, b) => {
    const aChanged = isFileChanged(a.displayPath, changedFiles) ? 0 : 1
    const bChanged = isFileChanged(b.displayPath, changedFiles) ? 0 : 1
    if (aChanged !== bChanged) return aChanged - bChanged
    const aPct = percentage(a.metrics.coveredStatements, a.metrics.statements)
    const bPct = percentage(b.metrics.coveredStatements, b.metrics.statements)
    return aPct - bPct
  })

  const rows: string[] = []

  if (hasDelta) {
    rows.push('| File | Lines | Methods | Branches | CRAP | Delta |')
    rows.push('|------|------:|--------:|---------:|-----:|------:|')
  } else {
    rows.push('| File | Lines | Methods | Branches | CRAP |')
    rows.push('|------|------:|--------:|---------:|-----:|')
  }

  for (const f of dirFiles) {
    const link = fileLink(f.displayPath, repoUrl)
    const changed = isFileChanged(f.displayPath, changedFiles)
    const tag = changed ? ' `changed`' : ''
    const lines = fmt(f.metrics.coveredStatements, f.metrics.statements, showAbsolute)
    const methods = fmt(f.metrics.coveredMethods, f.metrics.methods, showAbsolute)
    const branches = fmt(f.metrics.coveredConditionals, f.metrics.conditionals, showAbsolute)
    const crap = f.averageCrap > 0 ? f.averageCrap.toString() : '\u2014'

    if (hasDelta) {
      const baseFile = baseFiles!.get(f.displayPath)
      let deltaCol: string
      if (baseFile) {
        const curPct = percentage(f.metrics.coveredStatements, f.metrics.statements)
        const basePct = percentage(baseFile.metrics.coveredStatements, baseFile.metrics.statements)
        deltaCol = deltaStr(curPct, basePct)
      } else {
        deltaCol = '`new`'
      }
      rows.push(`| ${link}${tag} | ${lines} | ${methods} | ${branches} | ${crap} | ${deltaCol} |`)
    } else {
      rows.push(`| ${link}${tag} | ${lines} | ${methods} | ${branches} | ${crap} |`)
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
  repoUrl: string,
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
    const changedCount = countChangedInDir(dir, dirFiles, changedFiles)
    const openAttr = affected ? ' open' : ''
    const summary = dirSummary(dir, dirFiles, showAbsolute, affected, changedCount)
    const table = buildDirTable(dirFiles, baseFiles, showAbsolute, hasDelta, repoUrl, changedFiles)

    sections.push(
      `<details${openAttr}>\n<summary>${summary}</summary>\n\n${table}\n\n</details>`,
    )
  }

  return sections.join('\n\n')
}

function topCrapTable(
  methods: MethodInfo[],
  threshold: number,
  limit: number,
  repoUrl: string,
): string {
  const risky = methods
    .filter((m) => m.crap >= threshold)
    .sort((a, b) => b.crap - a.crap)
    .slice(0, limit)

  if (risky.length === 0) return ''

  const rows: string[] = [
    '',
    '---',
    '',
    `#### Risky Methods \u2014 CRAP \u2265 ${threshold}`,
    '',
    '| Method | File | CRAP | Coverage | Complexity |',
    '|--------|------|-----:|---------:|-----------:|',
  ]

  for (const m of risky) {
    const cov = percentage(m.coveredLines, m.lineCount)
    const fileRef = repoUrl
      ? `[\`${fileName(m.file)}\`](${repoUrl}/${m.file} "${m.file}")`
      : `\`${fileName(m.file)}\``
    rows.push(
      `| \`${m.className}::${m.name}\` | ${fileRef} | **${m.crap}** | ${cov}% | ${m.complexity} |`,
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

  const rows: string[] = [
    '',
    '---',
    '',
    '<details>',
    '<summary><b>Coverage Distribution</b></summary>',
    '',
    '```',
  ]

  for (let i = 0; i <= 10; i++) {
    const lo = i * 10
    const hi = i === 10 ? 100 : lo + 9
    const label = `${lo.toString().padStart(3)}-${hi.toString().padStart(3)}%`
    const filled = maxFreq > 0 ? Math.round((buckets[i] / maxFreq) * barWidth) : 0
    const b = CHAR_FILLED.repeat(filled) + ' '.repeat(barWidth - filled)
    rows.push(
      `  ${label}  ${b}  ${buckets[i]}`,
    )
  }

  rows.push('```')
  rows.push('')
  rows.push(`${totalFiles} files analyzed`)
  rows.push('')
  rows.push('</details>')

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

  const overallPct = percentage(
    current.projectMetrics.coveredStatements,
    current.projectMetrics.statements,
  )

  parts.push(`## Coverage Report \u2014 \`${shortSha}\` \u2014 ${overallPct}% ${coverageLabel(overallPct)}`)
  parts.push('')

  parts.push(
    summaryTable(
      current.projectMetrics,
      options.baseReport?.projectMetrics || null,
      options.showAbsoluteNumbers,
    ),
  )

  parts.push('')
  parts.push('---')
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
      options.repoUrl,
    ),
  )

  const crapSection = topCrapTable(
    current.allMethods,
    options.crapThreshold,
    options.topCrapLimit,
    options.repoUrl,
  )
  if (crapSection) parts.push(crapSection)

  if (options.withChart) {
    parts.push(distributionChart(current.files))
  }

  const totalFiles = current.files.filter(
    (f) => f.metrics.statements > 0 || f.metrics.methods > 0,
  ).length
  const totalDirs = new Set(
    current.files
      .filter((f) => f.metrics.statements > 0 || f.metrics.methods > 0)
      .map((f) => {
        const idx = f.displayPath.lastIndexOf('/')
        return idx >= 0 ? f.displayPath.substring(0, idx) : '.'
      }),
  ).size

  parts.push('')
  parts.push('---')
  parts.push(
    `<sub>${options.signature} \u2022 ${totalFiles} files \u2022 ${totalDirs} directories \u2022 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</sub>`,
  )

  return parts.join('\n')
}
