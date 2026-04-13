---
name: pr-review
description: Review Azure DevOps pull requests. Use when asked to review a PR, analyze a pull request, or when given an ADO PR URL.
allowed-tools: shell
---

# PR Review

Queue or run a PR review using the PR Reviewer system.

## Trigger
When a user asks to review a PR, or when a Teams message contains a PR review request with a URL like:
- `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{prId}`
- "Can you review PR #12345 in my-repo?"
- "Please review this PR: <url>"

## Default: Queue in background
Extract the PR URL from the user's message, then queue it:

```powershell
Invoke-RestMethod -Uri "http://localhost:3847/api/agent/launch" -Method POST -ContentType "application/json" -Body '{"prUrl":"{full PR URL}"}'
```

Tell the user:
> Queued PR review — check results at http://localhost:3847

**Stop here** unless the user explicitly asks to review in this session.

## Alternative: Review in-session
If the user says "review here" or "run it in this session", read and follow the full review instructions at:
```
~/pr-review-agent/skill/review/SKILL.md
```
