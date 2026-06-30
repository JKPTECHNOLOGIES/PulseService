# Workflow script for main device (yours)
# Allows you to push to 'develop' (auto-syncs partner) or promote to 'main' (requires your confirmation)
# Usage: powershell -ExecutionPolicy Bypass -File sync-workflow.ps1

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("status", "push-develop", "promote-to-main", "rebuild")]
    [string]$action = "status"
)

$projectPath = "C:\CODE\PulseService"
$currentBranch = git -C $projectPath rev-parse --abbrev-ref HEAD

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║        PulseService Sync Workflow Manager              ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

function Show-Status {
    Write-Host "Current Status:" -ForegroundColor Yellow
    Write-Host "  Branch: $currentBranch" -ForegroundColor Green

    $status = git -C $projectPath status --short
    if ($status) {
        Write-Host "  Uncommitted changes: $(($status | Measure-Object).Count) files"
        Write-Host ""
        Write-Host "Changes:" -ForegroundColor Yellow
        git -C $projectPath status --short
    } else {
        Write-Host "  Uncommitted changes: None ✓" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "Branch comparison:" -ForegroundColor Yellow
    git -C $projectPath log --oneline -n 3
}

function Push-Develop {
    Write-Host ""
    Write-Host "Pushing to 'develop' branch (partner auto-syncs in 5 min)..." -ForegroundColor Yellow
    Write-Host ""

    if ($currentBranch -ne "develop") {
        git -C $projectPath checkout develop
    }

    git -C $projectPath add -A
    $message = Read-Host "Commit message"
    if (-not $message) { $message = "Update from main device"; }

    git -C $projectPath commit -m $message
    git -C $projectPath push origin develop

    Write-Host ""
    Write-Host "✓ Pushed to develop. Partner device will auto-sync in ~5 minutes." -ForegroundColor Green
}

function Promote-To-Main {
    Write-Host ""
    Write-Host "⚠️  Promoting 'develop' changes to 'main' (CONFIRMED PRODUCTION)" -ForegroundColor Red
    Write-Host ""

    $confirm = Read-Host "Are you sure? This updates the stable branch. Type 'yes' to confirm"
    if ($confirm -ne "yes") {
        Write-Host "Cancelled." -ForegroundColor Yellow
        return
    }

    git -C $projectPath checkout main
    git -C $projectPath pull origin main
    git -C $projectPath merge develop

    if ($LASTEXITCODE -eq 0) {
        git -C $projectPath push origin main
        Write-Host ""
        Write-Host "✓ Successfully promoted to main branch!" -ForegroundColor Green
        Write-Host "  Both devices are now synced to stable version." -ForegroundColor Green
    } else {
        Write-Host "✗ Merge conflict. Resolve manually and try again." -ForegroundColor Red
    }
}

function Rebuild-Local {
    Write-Host ""
    Write-Host "Rebuilding Docker containers locally..." -ForegroundColor Yellow

    Set-Location $projectPath
    docker-compose down
    docker-compose up -d --build

    Write-Host ""
    Write-Host "✓ Docker containers rebuilt" -ForegroundColor Green
}

# Execute requested action
Write-Host "Available commands:" -ForegroundColor Cyan
Write-Host "  status           - Show current changes and branch status"
Write-Host "  push-develop     - Commit and push to 'develop' (auto-syncs partner)"
Write-Host "  promote-to-main  - Merge develop→main (confirmed production build)"
Write-Host "  rebuild          - Rebuild Docker containers locally"
Write-Host ""

if ($action -eq "status") { Show-Status }
elseif ($action -eq "push-develop") { Push-Develop }
elseif ($action -eq "promote-to-main") { Promote-To-Main }
elseif ($action -eq "rebuild") { Rebuild-Local }

Write-Host ""
