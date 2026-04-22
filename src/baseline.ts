import * as core from '@actions/core'
import * as github from '@actions/github'
import * as fs from 'fs'
import * as path from 'path'
import {execSync} from 'child_process'

const ARTIFACT_PREFIX = 'saci-coverage-baseline'

export function artifactName(branch: string): string {
  const safe = branch.replace(/[^a-zA-Z0-9._-]/g, '-')
  return `${ARTIFACT_PREFIX}-${safe}`
}

function getOctokit() {
  const token = process.env.GITHUB_TOKEN || core.getInput('github-token')
  if (!token) throw new Error('GITHUB_TOKEN is required for baseline-mode')
  return github.getOctokit(token)
}

export async function downloadBaseline(
  branch: string,
  workflowFile: string,
): Promise<string | null> {
  const octokit = getOctokit()
  const {owner, repo} = github.context.repo
  const name = artifactName(branch)

  core.info(`Searching for artifact "${name}" from branch "${branch}"...`)

  let runs
  try {
    const resp = await octokit.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: workflowFile,
      branch,
      status: 'success',
      per_page: 10,
    })
    runs = resp.data.workflow_runs
  } catch {
    core.info('Could not list workflow runs. Skipping baseline comparison.')
    return null
  }

  if (runs.length === 0) {
    core.info(`No successful runs found on branch "${branch}".`)
    return null
  }

  for (const run of runs) {
    let artifacts
    try {
      const resp = await octokit.rest.actions.listWorkflowRunArtifacts({
        owner,
        repo,
        run_id: run.id,
        per_page: 50,
      })
      artifacts = resp.data.artifacts
    } catch {
      continue
    }

    const match = artifacts.find((a) => a.name === name && !a.expired)
    if (!match) continue

    core.info(`Found baseline in run #${run.run_number} (${run.created_at})`)

    let zip: ArrayBuffer
    try {
      const resp = await octokit.rest.actions.downloadArtifact({
        owner,
        repo,
        artifact_id: match.id,
        archive_format: 'zip',
      })
      zip = resp.data as ArrayBuffer
    } catch {
      core.info(`Failed to download artifact from run ${run.id}, trying next...`)
      continue
    }

    const tmpDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'saci-baseline')
    fs.mkdirSync(tmpDir, {recursive: true})
    const zipPath = path.join(tmpDir, 'baseline.zip')
    fs.writeFileSync(zipPath, Buffer.from(zip))

    try {
      execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, {stdio: 'pipe'})
    } catch {
      core.warning('Failed to unzip baseline artifact.')
      continue
    }

    const xmlPath = path.join(tmpDir, 'coverage.xml')
    if (fs.existsSync(xmlPath)) {
      core.info('Baseline extracted successfully.')
      return xmlPath
    }

    const xmlFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.xml'))
    if (xmlFiles.length > 0) {
      const found = path.join(tmpDir, xmlFiles[0])
      core.info(`Baseline extracted: ${xmlFiles[0]}`)
      return found
    }

    core.warning(`No XML file found in artifact from run ${run.id}.`)
  }

  core.info('No usable baseline found in recent runs.')
  return null
}
