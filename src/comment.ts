import * as core from '@actions/core'
import * as github from '@actions/github'
import * as fs from 'fs'

const HIDDEN_MARKER_PREFIX = '<!-- saci-coverage-report:'

function buildMarker(signature: string): string {
  return `${HIDDEN_MARKER_PREFIX}${signature} -->`
}

export async function postComment(
  body: string,
  signature: string,
): Promise<void> {
  const token = process.env.GITHUB_TOKEN || core.getInput('github-token')
  if (!token) {
    core.warning('No GITHUB_TOKEN available, writing to step summary only.')
    writeSummary(body)
    return
  }

  const context = github.context
  const prNumber = context.payload.pull_request?.number

  if (!prNumber) {
    core.info('Not a pull request event, writing to step summary only.')
    writeSummary(body)
    return
  }

  const octokit = github.getOctokit(token)
  const marker = buildMarker(signature)
  const fullBody = `${marker}\n${body}`

  const {data: comments} = await octokit.rest.issues.listComments({
    ...context.repo,
    issue_number: prNumber,
    per_page: 100,
  })

  const existing = comments.find(
    (c) => c.body?.includes(HIDDEN_MARKER_PREFIX + signature),
  )

  if (existing) {
    await octokit.rest.issues.updateComment({
      ...context.repo,
      comment_id: existing.id,
      body: fullBody,
    })
    core.info(`Updated existing coverage comment #${existing.id}`)
  } else {
    const {data: created} = await octokit.rest.issues.createComment({
      ...context.repo,
      issue_number: prNumber,
      body: fullBody,
    })
    core.info(`Created coverage comment #${created.id}`)
  }

  writeSummary(body)
}

function writeSummary(body: string): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  if (summaryFile) {
    fs.appendFileSync(summaryFile, body + '\n')
    core.info('Coverage report written to step summary.')
  }
}
