# Saci Coverage Report

A GitHub Action that parses Clover XML coverage reports and posts detailed, well-structured PR comments. Built for PHP/PHPUnit projects but works with any tool that outputs Clover XML.

No external services, no tokens beyond the default `GITHUB_TOKEN`, no admin permissions required.

## Features

- **Summary table** with line, method, branch, and class coverage with progress bars
- **File-level breakdown** grouped by directory in collapsible sections
- **Baseline comparison** showing deltas against the target branch
- **Smart auto-expand** for directories containing files touched in the PR
- **CRAP index** (Change Risk Anti-Patterns) highlighting risky methods
- **Coverage distribution chart** showing file count per coverage range
- **Clickable file names** linking directly to the source at the exact commit SHA
- **Threshold enforcement** to fail the workflow on low or decreased coverage
- **Single comment** that gets updated on each push (no comment spam)
- **Step summary** output alongside the PR comment

## Quick Start

```yaml
- name: Coverage Report
  uses: thiagomrvieira/saci-coverage-report@v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    file: coverage.xml
```

## Full Example

A complete workflow that runs PHPUnit tests with Xdebug coverage, stores a baseline on each push to `staging`/`master`, and posts a comparison report on every PR:

```yaml
name: Tests

on:
  pull_request:
    branches: [staging, master]
  push:
    branches: [staging, master]

permissions:
  contents: read
  pull-requests: write
  actions: read

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'
          coverage: xdebug

      - name: Install dependencies
        run: composer install --no-progress --optimize-autoloader

      - name: Run tests
        run: php artisan test --coverage-clover=coverage.xml

      # Store baseline on push to target branches
      - if: github.event_name == 'push'
        name: Upload baseline
        uses: actions/upload-artifact@v4
        with:
          name: coverage-baseline
          path: coverage.xml
          retention-days: 90

      # Download baseline for comparison on PRs
      - if: github.event_name == 'pull_request'
        name: Download baseline
        uses: dawidd6/action-download-artifact@v7
        continue-on-error: true
        with:
          workflow: tests.yml
          branch: ${{ github.base_ref }}
          name: coverage-baseline
          path: base-coverage

      # Post coverage report
      - if: github.event_name == 'pull_request'
        name: Coverage Report
        uses: thiagomrvieira/saci-coverage-report@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          file: coverage.xml
          base-file: base-coverage/coverage.xml
          min-line-coverage: 0
          max-coverage-decrease: 5
          crap-threshold: 30
          top-crap-limit: 10
          with-chart: true
          show-absolute-numbers: true
          signature: "My Project — Coverage Report"
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `file` | yes | — | Path to the Clover XML coverage file |
| `base-file` | no | — | Path to the baseline Clover XML for delta comparison |
| `min-line-coverage` | no | `0` | Minimum line coverage percentage to pass the check |
| `max-coverage-decrease` | no | `100` | Maximum allowed coverage decrease in percentage points |
| `crap-threshold` | no | `30` | CRAP index threshold for flagging risky methods |
| `top-crap-limit` | no | `10` | Maximum number of methods to show in the risky methods table |
| `with-chart` | no | `true` | Include the coverage distribution chart |
| `show-absolute-numbers` | no | `true` | Show `45.2% (85/120)` instead of `45.2%` |
| `only-changed-files` | no | `false` | Only show files whose coverage changed (requires `base-file`) |
| `signature` | no | `saci-coverage-report` | Custom text in the report footer |

## Outputs

| Output | Description |
|--------|-------------|
| `line-coverage` | Line coverage percentage |
| `method-coverage` | Method coverage percentage |
| `branch-coverage` | Branch coverage percentage |
| `coverage-decreased` | `true` if coverage decreased compared to baseline |

Outputs can be used in subsequent steps:

```yaml
- name: Coverage Report
  id: coverage
  uses: thiagomrvieira/saci-coverage-report@v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    file: coverage.xml

- name: Check result
  run: echo "Line coverage is ${{ steps.coverage.outputs.line-coverage }}%"
```

## Report Structure

The generated report has four sections:

### 1. Summary Table

High-level metrics with progress bars and, when a baseline exists, delta values.

```
| Metric      | Coverage          |            | Base              | Delta    |
|-------------|------------------:|------------|------------------:|---------:|
| Lines       | 42.5% (340/800)   | ████░░░░░░ | 40.1% (310/773)   | **+2.4%**|
| Methods     | 38.7% (120/310)   | ███░░░░░░░ | 38.7% (118/305)   | —        |
| Branches    | 15.2% (45/296)    | █░░░░░░░░░ | 15.2% (44/289)    | —        |
| Classes     | 22.0% (20/91)     | ██░░░░░░░░ | 21.1% (19/90)     | +0.9%    |
```

### 2. File Breakdown

Files are grouped by directory in collapsible `<details>` sections. Each group header shows:

- Directory path
- `changed` tag if the directory was touched in the PR
- Aggregated coverage bar and percentage
- File count

Directories containing PR changes are **expanded by default**. All others are collapsed.

Each file name is a link to the source at the exact commit SHA.

### 3. Risky Methods

Methods with a CRAP index above the threshold are listed with their file, coverage, and cyclomatic complexity.

**CRAP** (Change Risk Anti-Patterns) combines complexity and coverage:

```
CRAP(m) = complexity(m)² × (1 - coverage(m))³ + complexity(m)
```

A method with high complexity and low test coverage will have a high CRAP score, signaling that changes to it carry significant risk. The default threshold is 30.

### 4. Coverage Distribution

A collapsible ASCII histogram showing how files are distributed across coverage ranges (0-9%, 10-19%, ..., 100%).

## How It Works

1. Parses the Clover XML file generated by PHPUnit (or any Clover-compatible tool)
2. If a `base-file` is provided, parses it and computes deltas
3. Fetches the list of files changed in the PR via the GitHub API
4. Generates a Markdown report with all sections
5. Posts or updates a single PR comment (identified by a hidden marker)
6. Writes the same report to `$GITHUB_STEP_SUMMARY`
7. Sets output variables and enforces thresholds

## Requirements

- The workflow must set `GITHUB_TOKEN` as an environment variable
- The workflow needs `pull-requests: write` permission to post comments
- The workflow needs `actions: read` permission if using `dawidd6/action-download-artifact` for baselines
- Coverage must be generated in Clover XML format (`--coverage-clover`)

### Coverage Drivers

The action works with any Clover XML output. For PHPUnit:

| Driver | Flag | Branch coverage | CRAP index | Speed |
|--------|------|:-:|:-:|-------|
| **Xdebug** | `coverage: xdebug` | yes | yes | slower |
| **PCOV** | `coverage: pcov` | no | limited | faster |

Xdebug is recommended for the richest reports (branch coverage, accurate CRAP values). PCOV is a good option when CI speed is a priority and branch-level detail is not needed.

## Permissions

The action uses only the default `GITHUB_TOKEN`. No external services, no repository secrets, and no admin access are required.

```yaml
permissions:
  contents: read        # checkout code
  pull-requests: write  # post/update PR comment
  actions: read         # download baseline artifacts
```

## License

MIT
