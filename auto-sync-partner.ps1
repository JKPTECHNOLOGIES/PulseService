# Auto-sync script for partner's device
# Pulls latest code from 'develop' branch and rebuilds Docker containers
# Run this in PowerShell as: powershell -ExecutionPolicy Bypass -File auto-sync-partner.ps1

$projectPath = "C:\CODE\PulseService"
$logFile = "$projectPath\auto-sync.log"
$syncInterval = 300  # 5 minutes in seconds
$branch = "develop"  # Partner syncs from 'develop' branch

function Log {
    param([string]$message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] $message"
    Write-Host $logMessage
    Add-Content -Path $logFile -Value $logMessage
}

function Sync-Code {
    Set-Location $projectPath

    # Check for changes on remote
    git fetch origin
    $localCommit = git rev-parse $branch
    $remoteCommit = git rev-parse origin/$branch

    if ($localCommit -ne $remoteCommit) {
        Log "Changes detected on $branch branch. Syncing..."

        # Checkout develop and pull
        git checkout $branch
        git pull origin $branch

        if ($LASTEXITCODE -eq 0) {
            Log "✓ Code pulled successfully"

            # Rebuild Docker containers
            Log "Rebuilding Docker containers..."
            docker-compose down
            docker-compose up -d --build

            if ($LASTEXITCODE -eq 0) {
                Log "✓ Docker containers rebuilt and running"
                Log "================================"
            } else {
                Log "✗ Docker rebuild failed"
            }
        } else {
            Log "✗ Git pull failed"
        }
    } else {
        Log "No changes on $branch branch"
    }
}

# Main loop
Log "Auto-sync service started for branch: $branch"
Log "Sync interval: $syncInterval seconds"
Log "================================"

while ($true) {
    try {
        Sync-Code
    } catch {
        Log "✗ Error during sync: $_"
    }

    Start-Sleep -Seconds $syncInterval
}
