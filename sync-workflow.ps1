param([string]$action = "status")

$projectPath = "C:\CODE\PulseService"

Write-Host ""
Write-Host "PulseService Sync Workflow" -ForegroundColor Cyan
Write-Host ""

if ($action -eq "status") {
    $branch = git -C $projectPath rev-parse --abbrev-ref HEAD
    Write-Host "Current Branch: $branch" -ForegroundColor Green
    Write-Host ""
    git -C $projectPath status
}
elseif ($action -eq "push-develop") {
    Write-Host "Pushing to develop branch..." -ForegroundColor Yellow
    git -C $projectPath checkout develop
    git -C $projectPath add -A
    $msg = Read-Host "Enter commit message"
    git -C $projectPath commit -m "$msg"
    git -C $projectPath push origin develop
    Write-Host ""
    Write-Host "Done! Partner device will auto-sync in 5 minutes." -ForegroundColor Green
}
elseif ($action -eq "promote-to-main") {
    Write-Host ""
    Write-Host "WARNING: Promoting develop to main (PRODUCTION)" -ForegroundColor Red
    Write-Host ""
    $confirm = Read-Host "Type YES to confirm"
    if ($confirm -eq "YES") {
        git -C $projectPath checkout main
        git -C $projectPath pull origin main
        git -C $projectPath merge develop
        git -C $projectPath push origin main
        Write-Host ""
        Write-Host "Promoted! Both devices are now synced." -ForegroundColor Green
    }
}
elseif ($action -eq "rebuild") {
    Write-Host "Rebuilding Docker containers..." -ForegroundColor Yellow
    Set-Location $projectPath
    docker-compose down
    docker-compose up -d --build
    Write-Host ""
    Write-Host "Docker containers rebuilt!" -ForegroundColor Green
}

Write-Host ""
Write-Host "Usage:" -ForegroundColor Yellow
Write-Host "  sync-workflow.ps1 status        - Show current git status"
Write-Host "  sync-workflow.ps1 push-develop  - Push to develop branch"
Write-Host "  sync-workflow.ps1 promote-to-main - Merge develop to main"
Write-Host "  sync-workflow.ps1 rebuild       - Rebuild Docker"
Write-Host ""
