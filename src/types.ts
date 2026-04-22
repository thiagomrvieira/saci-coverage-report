export interface Metrics {
  statements: number
  coveredStatements: number
  methods: number
  coveredMethods: number
  conditionals: number
  coveredConditionals: number
  elements: number
  coveredElements: number
  complexity: number
  loc: number
  ncloc: number
  classes: number
  coveredClasses: number
}

export interface MethodInfo {
  name: string
  className: string
  file: string
  crap: number
  complexity: number
  coverage: number
  lineCount: number
  coveredLines: number
}

export interface FileMetrics {
  path: string
  displayPath: string
  metrics: Metrics
  methods: MethodInfo[]
  averageCrap: number
}

export interface CoverageReport {
  projectMetrics: Metrics
  files: FileMetrics[]
  allMethods: MethodInfo[]
}

export interface CoverageComparison {
  current: CoverageReport
  base: CoverageReport | null
}

export function percentage(covered: number, total: number): number {
  if (total === 0) return 0
  return Math.round((covered / total) * 10000) / 100
}

export function delta(current: number, base: number): number {
  return Math.round((current - base) * 100) / 100
}
