import * as core from '@actions/core'
import * as github from '@actions/github'
import * as fs from 'fs'
import {parseCloverXml} from './parser'
import {formatReport} from './formatter'
import {postComment} from './comment'
import {percentage} from './types'

async function run(): Promise<void> {
  try {
    const file = core.getInput('file', {required: true})
    const baseFile = core.getInput('base-file')
    const minLineCoverage = parseFloat(core.getInput('min-line-coverage') || '0')
    const maxCoverageDecrease = parseFloat(
      core.getInput('max-coverage-decrease') || '100',
    )
    const crapThreshold = parseFloat(core.getInput('crap-threshold') || '30')
    const topCrapLimit = parseInt(core.getInput('top-crap-limit') || '10', 10)
    const withChart = core.getInput('with-chart') !== 'false'
    const showAbsoluteNumbers =
      core.getInput('show-absolute-numbers') !== 'false'
    const onlyChangedFiles = core.getInput('only-changed-files') === 'true'
    const signature = core.getInput('signature') || 'saci-coverage-report'

    if (!fs.existsSync(file)) {
      throw new Error(`Coverage file not found: ${file}`)
    }

    const workspacePrefix = process.env.GITHUB_WORKSPACE
      ? process.env.GITHUB_WORKSPACE + '/'
      : ''

    core.info(`Parsing coverage file: ${file}`)
    const current = await parseCloverXml(file, workspacePrefix)

    let baseReport = null
    if (baseFile && fs.existsSync(baseFile)) {
      core.info(`Parsing base coverage file: ${baseFile}`)
      baseReport = await parseCloverXml(baseFile, workspacePrefix)
    } else if (baseFile) {
      core.info(`Base file not found: ${baseFile}, skipping comparison.`)
    }

    const commitSha =
      github.context.payload.pull_request?.head?.sha ||
      github.context.sha ||
      'unknown'

    const markdown = formatReport(current, {
      showAbsoluteNumbers,
      withChart,
      crapThreshold,
      topCrapLimit,
      onlyChangedFiles,
      signature,
      commitSha,
      baseReport,
    })

    await postComment(markdown, signature)

    const lineCoverage = percentage(
      current.projectMetrics.coveredStatements,
      current.projectMetrics.statements,
    )
    const methodCoverage = percentage(
      current.projectMetrics.coveredMethods,
      current.projectMetrics.methods,
    )
    const branchCoverage = percentage(
      current.projectMetrics.coveredConditionals,
      current.projectMetrics.conditionals,
    )

    core.setOutput('line-coverage', lineCoverage.toString())
    core.setOutput('method-coverage', methodCoverage.toString())
    core.setOutput('branch-coverage', branchCoverage.toString())

    let coverageDecreased = false
    if (baseReport) {
      const baseLineCoverage = percentage(
        baseReport.projectMetrics.coveredStatements,
        baseReport.projectMetrics.statements,
      )
      const decrease = baseLineCoverage - lineCoverage
      coverageDecreased = decrease > 0
      core.setOutput('coverage-decreased', coverageDecreased.toString())

      if (decrease > maxCoverageDecrease) {
        core.setFailed(
          `Line coverage decreased by ${decrease.toFixed(2)}% (max allowed: ${maxCoverageDecrease}%)`,
        )
        return
      }
    } else {
      core.setOutput('coverage-decreased', 'false')
    }

    if (lineCoverage < minLineCoverage) {
      core.setFailed(
        `Line coverage ${lineCoverage}% is below minimum ${minLineCoverage}%`,
      )
      return
    }

    core.info(`Coverage report posted successfully. Lines: ${lineCoverage}%`)
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}

run()
