# Installs the pr-review skill to ~/.agents/skills/pr-review/
# so Copilot CLI picks it up globally.

$SkillDir = Join-Path $HOME ".agents" "skills" "pr-review"
$SourceDir = Join-Path $PSScriptRoot "skill"

# Create target directory
New-Item -ItemType Directory -Path $SkillDir -Force | Out-Null

# Copy all skill files
Copy-Item -Path "$SourceDir\*" -Destination $SkillDir -Recurse -Force

Write-Host ""
Write-Host "  Installed pr-review skill to:" -ForegroundColor Green
Write-Host "    $SkillDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "  In Copilot CLI, run:" -ForegroundColor Yellow
Write-Host "    /skills reload" -ForegroundColor White
Write-Host "    /skills list         (to verify)" -ForegroundColor White
Write-Host ""
Write-Host "  Or just ask Copilot:" -ForegroundColor Yellow
Write-Host '    "Use /pr-review to review PR https://dev.azure.com/..."' -ForegroundColor White
Write-Host ""
