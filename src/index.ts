import * as core from '@actions/core'
import * as github from '@actions/github'
import * as fs from 'fs'
import {parseCloverXml} from './parser'
import {formatReport} from './formatter'
import {postComment} from './comment'
import {downloadBaseline, artifactName} from './baseline'
import {percentage} from './types'

async function run(): Promise<void> {
  try {
    const file = core.getInput('file', {required: true})
    const baseFileInput = core.getInput('base-file')
    const baselineMode = core.getInput('baseline-mode') === 'true'
    const baselineRetentionDays = parseInt(core.getInput('baseline-retention-days') || '90', 10)
    const workflowFile = core.getInput('workflow-file')
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

    const eventName = github.context.eventName
    const isPush = eventName === 'push'
    const isPR = eventName === 'pull_request' || eventName === 'pull_request_target'

    if (baselineMode && isPush) {
      const branch = process.env.GITHUB_REF_NAME || 'unknown'
      const name = artifactName(branch)
      core.setOutput('baseline-artifact-name', name)
      core.setOutput('baseline-artifact-path', file)
      core.setOutput('baseline-retention-days', baselineRetentionDays.toString())
      core.info(
        `Push event detected with baseline-mode. ` +
        `Use actions/upload-artifact to upload "${name}" with path "${file}" ` +
        `(retention: ${baselineRetentionDays} days). ` +
        `Or use the outputs of this step in a subsequent upload-artifact step.`,
      )
    }

    const workspacePrefix = process.env.GITHUB_WORKSPACE
      ? process.env.GITHUB_WORKSPACE + '/'
      : ''

    core.info(`Parsing coverage file: ${file}`)
    const current = await parseCloverXml(file, workspacePrefix)

    let baseFile = baseFileInput
    if (baselineMode && isPR && !baseFile) {
      const baseBranch = github.context.payload.pull_request?.base?.ref
      if (baseBranch && workflowFile) {
        core.info(`Baseline mode: downloading baseline from branch "${baseBranch}"...`)
        const downloaded = await downloadBaseline(baseBranch, workflowFile)
        if (downloaded) {
          baseFile = downloaded
        }
      } else if (!baseBranch) {
        core.info('Could not determine base branch for baseline download.')
      } else if (!workflowFile) {
        core.warning('baseline-mode requires workflow-file input to find baseline runs.')
      }
    }

    let baseReport = null
    if (baseFile && fs.existsSync(baseFile)) {
      core.info(`Parsing base coverage: ${baseFile}`)
      baseReport = await parseCloverXml(baseFile, workspacePrefix)
    } else if (baseFile) {
      core.info(`Base file not found: ${baseFile}, skipping comparison.`)
    }

    const commitSha =
      github.context.payload.pull_request?.head?.sha ||
      github.context.sha ||
      'unknown'

    let changedFiles: string[] = []
    const prNumber = github.context.payload.pull_request?.number
    const token = process.env.GITHUB_TOKEN || core.getInput('github-token')
    if (prNumber && token) {
      try {
        const octokit = github.getOctokit(token)
        const {data: prFiles} = await octokit.rest.pulls.listFiles({
          ...github.context.repo,
          pull_number: prNumber,
          per_page: 300,
        })
        changedFiles = prFiles.map((f) => f.filename)
        core.info(`PR touches ${changedFiles.length} files`)
      } catch {
        core.info('Could not fetch PR files, all groups will be open.')
      }
    }

    const {owner, repo} = github.context.repo
    const repoUrl = `https://github.com/${owner}/${repo}/blob/${commitSha}`

    const markdown = formatReport(current, {
      showAbsoluteNumbers,
      withChart,
      crapThreshold,
      topCrapLimit,
      onlyChangedFiles,
      signature,
      commitSha,
      baseReport,
      changedFiles,
      repoUrl,
    })

    if (isPR) {
      await postComment(markdown, signature)
    } else {
      const summaryFile = process.env.GITHUB_STEP_SUMMARY
      if (summaryFile) {
        fs.appendFileSync(summaryFile, markdown + '\n')
        core.info('Coverage report written to step summary.')
      }
    }

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
