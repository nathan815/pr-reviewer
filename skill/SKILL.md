---
name: pr-review
description: Review Azure DevOps pull requests and generate structured feedback. Use when asked to review a PR, analyze a pull request, or when given an ADO PR URL.
allowed-tools: shell
---

# PR Review Agent Skill

Review Azure DevOps pull requests and generate structured feedback files for the PR Review Agent web UI.

## Trigger
When a user asks to review a PR, or when a Teams message contains a PR review request with a URL like:
- `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{prId}`
- "Can you review PR #12345 in AVS-Tools?"
- "Please review this PR: <url>"

## Workflow

### Step 1: Parse the PR
Extract the repo name and PR ID from the user's message or URL.

### Step 2: Check for existing progress
Before starting fresh, check if a previous review run exists and what state it's in:
```powershell
$reviewDir = "$HOME\pr-reviews\{repo}\{prId}"

# Check what already exists
$hasMetadata = Test-Path "$reviewDir\metadata.json"
$hasFeedback = Test-Path "$reviewDir\feedback.json"
$hasRisk = Test-Path "$reviewDir\risk-assessment.json"
$hasOverview = Test-Path "$reviewDir\overview.md"
$hasWorktree = Test-Path "$reviewDir\worktree\.git"
$hasLock = Test-Path "$reviewDir\.review.lock"
```

If some files already exist from a prior run, **resume from where it left off** rather than redoing everything:
- If worktree exists → skip Step 5
- If feedback.json exists → skip the review (Step 9) unless user asked to re-review
- If risk-assessment.json is missing but feedback exists → just write the missing files
- If overview.md is missing → just write it
- If a stale lockfile exists (process not alive), remove it and continue

### Step 3: Acquire lock
Before starting the review, check for and write a lockfile to prevent concurrent reviews of the same PR:
```powershell
$lockFile = "$reviewDir\.review.lock"

# Check for existing lock
if (Test-Path $lockFile) {
  $lock = Get-Content $lockFile | ConvertFrom-Json
  # Check if the locking process is still alive
  if (Get-Process -Id $lock.pid -ErrorAction SilentlyContinue) {
    Write-Error "PR is already being reviewed by PID $($lock.pid)"
    exit 1
  }
  # Stale lock — remove it
  Remove-Item $lockFile -Force
}

# Write our lock
New-Item -ItemType Directory -Path $reviewDir -Force | Out-Null
@{ pid = $PID; startedAt = (Get-Date -Format o) } | ConvertTo-Json | Set-Content $lockFile
```

### Step 4: Write initial metadata
Write metadata.json **immediately** so the UI shows the PR while the review is in progress:
```powershell
$reviewDir = "$HOME\pr-reviews\{repo}\{prId}"
$metadata = @{
  prId = {prId}
  repo = "{repo}"
  title = "{PR title}"
  author = "{PR author}"
  sourceBranch = "{source branch}"
  targetBranch = "{target branch}"
  url = "{PR URL}"
  reviewedAt = (Get-Date -Format o)
  status = "agent_review_requested"
} | ConvertTo-Json
Set-Content "$reviewDir\metadata.json" $metadata
```

### Step 5: Get PR details
Use the `ado-repo_get_pull_request_by_id` tool to fetch PR metadata:
```
repo: {repoName}
pullRequestId: {prId}
project: {projectName}
```
Update metadata.json with any additional details from the API response.

### Step 6: Set up worktree
Create a git worktree for the PR branch so the code can be reviewed:
```powershell
$reviewDir = "$HOME\pr-reviews\{repo}\{prId}"
New-Item -ItemType Directory -Path $reviewDir -Force
cd {repoRoot}
git worktree add "$reviewDir\worktree" {sourceBranch}
```

### Step 7: Get the diff
Use the ADO API to get the **exact** list of changed files — this is authoritative and matches what ADO shows in the PR files tab:
```
Use ado-repo_get_pull_request_iterations and ado-repo_get_pull_request_iteration_changes tools to get the changed files from ADO.
```

Then compute the merge-base and diff only those files:
```powershell
cd "$HOME\pr-reviews\{repo}\{prId}\worktree"
$mergeBase = git merge-base {targetBranch} HEAD
# Only diff files that ADO reports as changed
git diff $mergeBase HEAD -- {file1} {file2} ...
```

**IMPORTANT**: Do NOT use `git diff {targetBranch}...HEAD` as it can include unrelated files from complex branching. Always use the merge-base approach and only review files that the ADO API lists as changed in the PR.

### Step 8: Load extra instructions
Check for user-provided extra instructions:
```powershell
if (Test-Path "$HOME\pr-reviews\extra_instructions.md") {
  Get-Content "$HOME\pr-reviews\extra_instructions.md"
}
```
If extra instructions exist, follow them — they provide important context like where repos are located, review preferences, and project-specific information.

### Step 9: Load reviewer guidelines
Before reviewing, check for curated guidelines that reflect the user's preferences:
```powershell
# Global guidelines
if (Test-Path "$HOME\pr-reviews\.learnings\guidelines.md") {
  Get-Content "$HOME\pr-reviews\.learnings\guidelines.md"
}
# Repo-specific guidelines
if (Test-Path "$HOME\pr-reviews\.learnings\repo\{repo}\guidelines.md") {
  Get-Content "$HOME\pr-reviews\.learnings\repo\{repo}\guidelines.md"
}
```
If guidelines exist, follow them closely — they represent the user's calibrated preferences for what to comment on, what to ignore, severity levels, and tone. Repo-specific guidelines take precedence over global ones for that repo.

### Step 10: Review the code
For each changed file, analyze the diff and generate feedback. Look for:
- **Bugs**: Logic errors, null references, off-by-one errors, race conditions
- **Security**: Injection vulnerabilities, auth issues, secrets exposure, input validation
- **Performance**: N+1 queries, unnecessary allocations, missing caching, blocking calls
- **Design**: SOLID violations, coupling issues, missing abstractions
- **Testing**: Missing tests for new code, untested edge cases
- **Documentation**: Missing or outdated comments for public APIs

**CRITICAL — Line number accuracy**: Before writing any feedback item, you MUST verify the exact line number using `grep -n` in the worktree:
```powershell
cd "$HOME\pr-reviews\{repo}\{prId}\worktree"
# Search for the specific code you're commenting on to get the real line number
grep -n "the code snippet or unique string" "{file}"
```
Do NOT guess or estimate line numbers from reading file content — LLMs frequently miscount lines in large files. Always use `grep -n` to find the actual line number for the code you're referencing. If the code spans multiple lines, use the first matched line as `startLine` and verify `endLine` similarly.

### Step 11: Write review files
Write the following files to `~/pr-reviews/{repo}/{prId}/`:

#### metadata.json
```json
{
  "prId": {prId},
  "repo": "{repo}",
  "title": "{PR title}",
  "author": "{PR author email}",
  "sourceBranch": "{source branch}",
  "targetBranch": "{target branch}",
  "url": "{PR URL}",
  "commitSha": "{HEAD commit SHA of the source branch at review time}",
  "changedFiles": ["src/file1.cs", "src/file2.cs"],
  "reviewedAt": "{ISO timestamp}",
  "status": "agent_review_done"
}
```
Get the commit SHA and changed files list:
```powershell
cd "$HOME\pr-reviews\{repo}\{prId}\worktree"
$commitSha = git rev-parse HEAD
$changedFiles = git diff {targetBranch}...HEAD --name-only
```

#### feedback.json
Generate feedback items with unique IDs. Each item MUST include file path, line numbers, and the commit SHA being reviewed:
```json
{
  "items": [
    {
      "id": "f-{random8chars}",
      "file": "src/path/to/file.ts",
      "startLine": 42,
      "endLine": 45,
      "commitSha": "{same HEAD commit SHA from metadata}",
      "severity": "high|medium|low|info",
      "category": "bug|security|performance|style|design|testing|documentation",
      "title": "Short descriptive title",
      "comment": "Detailed explanation of the issue and why it matters.",
      "suggestion": "Concrete suggestion for how to fix it. Include code if helpful.",
      "status": "pending",
      "adoThreadId": null
    }
  ]
}
```

#### risk-assessment.json
```json
{
  "overallRisk": "high|medium|low",
  "areas": [
    {
      "area": "Area name (e.g., Security, Data Integrity, Performance)",
      "risk": "high|medium|low",
      "reason": "Why this area is risky in this PR"
    }
  ]
}
```

#### overview.md
Write a human-readable summary covering:
- What the PR does (1-2 sentences)
- Key changes and their impact
- Overall assessment and recommendation
- Any questions for the author

### Step 12: Release lock and confirm
Remove the lockfile and update metadata status:
```powershell
Remove-Item "$HOME\pr-reviews\{repo}\{prId}\.review.lock" -Force -ErrorAction SilentlyContinue
```
Update `metadata.json` — set status to `agent_review_done` unconditionally (it may have been changed to `agent_review_failed` by the server if it restarted mid-review, but since we completed successfully, override it back).

Tell the user the review is ready and provide a link:
```
Review ready! Open http://localhost:3847/review/{repo}/{prId} to see feedback.
Found {N} feedback items ({H} high, {M} medium, {L} low severity).
Overall risk: {risk level}
```

## Important Notes
- **Do NOT remove the worktree** after the review. The web UI needs it to display code snippets inline with feedback comments.
- Generate IDs using `f-` prefix plus 8 random alphanumeric characters
- Always include file paths relative to repo root (no leading slash)
- Line numbers must be from the NEW version of the file (right side of diff)
- **Always verify line numbers with `grep -n`** before writing feedback — never rely on counting lines from file content
- Be specific in comments — reference variable names, function names, etc.
- Provide actionable suggestions, not just problem descriptions
- Severity guide:
  - **high**: Bugs, security issues, data loss risks
  - **medium**: Performance issues, design concerns, missing error handling
  - **low**: Style issues, minor improvements
  - **info**: Observations, questions, positive feedback
