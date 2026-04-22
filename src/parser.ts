import * as fs from 'fs'
import {parseStringPromise} from 'xml2js'
import {CoverageReport, FileMetrics, MethodInfo, Metrics} from './types'

function parseMetrics(attrs: Record<string, string>): Metrics {
  return {
    statements: parseInt(attrs.statements || '0', 10),
    coveredStatements: parseInt(attrs.coveredstatements || '0', 10),
    methods: parseInt(attrs.methods || '0', 10),
    coveredMethods: parseInt(attrs.coveredmethods || '0', 10),
    conditionals: parseInt(attrs.conditionals || '0', 10),
    coveredConditionals: parseInt(attrs.coveredconditionals || '0', 10),
    elements: parseInt(attrs.elements || '0', 10),
    coveredElements: parseInt(attrs.coveredelements || '0', 10),
    complexity: parseInt(attrs.complexity || '0', 10),
    loc: parseInt(attrs.loc || '0', 10),
    ncloc: parseInt(attrs.ncloc || '0', 10),
    classes: parseInt(attrs.classes || '0', 10),
    coveredClasses: parseInt(attrs.coveredclasses || '0', 10),
  }
}

function extractMethods(
  fileNode: Record<string, unknown>,
  filePath: string,
): MethodInfo[] {
  const methods: MethodInfo[] = []
  const lines = (fileNode.line as Record<string, unknown>[] | undefined) || []
  const classNodes =
    (fileNode.class as Record<string, unknown>[] | undefined) || []
  const className =
    classNodes.length > 0
      ? (classNodes[0].$ as Record<string, string>)?.name || 'Unknown'
      : 'Unknown'

  for (const line of lines) {
    const attrs = line.$ as Record<string, string>
    if (attrs.type !== 'method') continue

    const methodName = attrs.name || 'unknown'
    const crap = parseFloat(attrs.crap || '0')
    const complexity = parseInt(attrs.complexity || '0', 10)
    const count = parseInt(attrs.count || '0', 10)

    const stmtLines = lines.filter((l) => {
      const la = l.$ as Record<string, string>
      return la.type === 'stmt'
    })

    const coveredStmts = stmtLines.filter((l) => {
      const la = l.$ as Record<string, string>
      return parseInt(la.count || '0', 10) > 0
    })

    methods.push({
      name: methodName,
      className,
      file: filePath,
      crap,
      complexity,
      coverage: count > 0 ? 100 : 0,
      lineCount: stmtLines.length,
      coveredLines: coveredStmts.length,
    })
  }

  return methods
}

function countClasses(
  fileNode: Record<string, unknown>,
): {total: number; covered: number} {
  const classNodes =
    (fileNode.class as Record<string, unknown>[] | undefined) || []
  let total = 0
  let covered = 0

  for (const cls of classNodes) {
    const metrics = cls.metrics as Record<string, unknown>[] | undefined
    if (!metrics || metrics.length === 0) continue
    const attrs = (metrics[0] as Record<string, unknown>)
      .$ as Record<string, string>
    if (!attrs) continue

    const stmts = parseInt(attrs.statements || '0', 10)
    const covStmts = parseInt(attrs.coveredstatements || '0', 10)

    if (stmts > 0) {
      total++
      if (covStmts === stmts) covered++
    }
  }

  return {total, covered}
}

export async function parseCloverXml(
  filePath: string,
  dirPrefix?: string,
): Promise<CoverageReport> {
  const xml = fs.readFileSync(filePath, 'utf-8')
  const parsed = await parseStringPromise(xml)

  const project = parsed.coverage?.project?.[0]
  if (!project) {
    throw new Error(`Invalid clover.xml: no <project> element found in ${filePath}`)
  }

  const projectMetricsNode = project.metrics?.[0]?.$
  const projectMetrics = projectMetricsNode
    ? parseMetrics(projectMetricsNode)
    : parseMetrics({})

  const files: FileMetrics[] = []
  const allMethods: MethodInfo[] = []

  const packages = project.package || []
  const topLevelFiles = project.file || []

  const allFileNodes: Record<string, unknown>[] = []

  for (const pkg of packages) {
    const pkgFiles = pkg.file || []
    allFileNodes.push(...pkgFiles)
  }
  allFileNodes.push(...topLevelFiles)

  let totalClasses = 0
  let coveredClassesCount = 0

  for (const fileNode of allFileNodes) {
    const attrs = (fileNode as Record<string, unknown>)
      .$ as Record<string, string>
    const rawPath = attrs?.name || 'unknown'

    let displayPath = rawPath
    if (dirPrefix && displayPath.startsWith(dirPrefix)) {
      displayPath = displayPath.slice(dirPrefix.length)
    }
    if (displayPath.startsWith('/')) {
      displayPath = displayPath.slice(1)
    }

    const metricsNode = (
      fileNode as Record<string, unknown>
    ).metrics as Record<string, unknown>[]
    const fileMetricsAttrs = metricsNode?.[0]?.$ as Record<string, string>
    const metrics = fileMetricsAttrs
      ? parseMetrics(fileMetricsAttrs)
      : parseMetrics({})

    const methods = extractMethods(
      fileNode as Record<string, unknown>,
      displayPath,
    )

    const classCounts = countClasses(fileNode as Record<string, unknown>)
    totalClasses += classCounts.total
    coveredClassesCount += classCounts.covered
    metrics.classes = classCounts.total
    metrics.coveredClasses = classCounts.covered

    const methodCraps = methods.filter((m) => m.crap > 0).map((m) => m.crap)
    const averageCrap =
      methodCraps.length > 0
        ? Math.round(
            (methodCraps.reduce((a, b) => a + b, 0) / methodCraps.length) * 10,
          ) / 10
        : 0

    files.push({path: rawPath, displayPath, metrics, methods, averageCrap})
    allMethods.push(...methods)
  }

  projectMetrics.classes = totalClasses
  projectMetrics.coveredClasses = coveredClassesCount

  return {projectMetrics, files, allMethods}
}
