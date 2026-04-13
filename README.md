# PR Review Agent

A local code review agent that reviews ADO pull requests and lets you curate feedback before posting.

## Quick Start

```powershell
cd ~/pr-review-agent
cp config.example.json config.json   # Then edit with your ADO org/project
npm run install-skill                 # Install the /pr-review skill for Copilot CLI
npm run dev                           # Start the web UI
# → Server: http://localhost:3847
# → UI:     http://localhost:5173
```

## How It Works

### 1. Queue a PR for review
Use the Copilot skill in your terminal:
```
# Read the skill file, then ask Copilot to review a PR
"Review PR https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/12345"
```

The skill will:
- Fetch PR details from ADO
- Create a git worktree at `~/pr-reviews/{repo}/{prId}/worktree/`
- Analyze the diff and generate feedback
- Write review files to `~/pr-reviews/{repo}/{prId}/`

### 2. Review feedback in the UI
Open http://localhost:5173 to see:
- **Dashboard** — all reviewed PRs with risk levels and feedback counts
- **Detail view** — overview, risk areas, and individual feedback items
- Accept or reject each feedback item
- Bulk accept all pending items

### 3. Post to ADO
Click "Post to ADO" to post accepted comments as PR threads under your identity.

Requires `az login`.

ADO org/project defaults are stored in `config.json`:
```json
{
  "ado": {
    "org": "your-org",
    "project": "YourProject"
  }
}
```

Environment variables are optional overrides:
```powershell
$env:ADO_ORG = "your-org"
$env:ADO_PROJECT = "YourProject"
```
Token is fetched automatically via `az account get-access-token` and cached until expiry.

## File Structure

```
~/pr-reviews/{repo}/{prId}/
  ├── metadata.json         # PR metadata
  ├── overview.md           # Human-readable summary
  ├── risk-assessment.json  # Risk areas
  ├── feedback.json         # Feedback items (accept/reject/post)
  └── worktree/             # Git worktree of PR branch
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reviews` | List all reviews |
| GET | `/api/reviews/:repo/:prId` | Get single review |
| PATCH | `/api/reviews/:repo/:prId/feedback/:id` | Update feedback status |
| POST | `/api/reviews/:repo/:prId/feedback/batch-update` | Batch update statuses |
| POST | `/api/ado/post-comment` | Post single comment to ADO |
| POST | `/api/ado/post-accepted` | Post all accepted comments |
| GET | `/api/reviews/:repo/:prId/file?path=...` | Read worktree file |

## Copilot Skill

The skill file is at `skill/SKILL.md`. To use it, load it as a Copilot skill or reference it when asking Copilot to review a PR.
