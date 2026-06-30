# Multi-Device Sync Workflow

This document explains how to keep code synchronized between two devices while allowing the main device to review and confirm important changes.

## Setup

### Your Device (Main/Review Device)
- Use `sync-workflow.ps1` to manage code changes
- Push to `develop` branch for testing
- Promote to `main` branch for confirmed production changes

### Partner's Device (Auto-Sync Device)
- Run `auto-sync-partner.ps1` to auto-pull changes every 5 minutes
- Automatically rebuilds Docker containers when code changes
- Always stays synced to `develop` branch

## Branches

- **`main`**: Stable, production-ready code. Requires your confirmation to merge.
- **`develop`**: Testing/development branch. Changes here auto-sync to partner in 5 minutes.

## Workflow

### 1. Making Changes on Your Device

Make changes to the code, then push to `develop` for your partner to test:

```powershell
powershell -ExecutionPolicy Bypass -File sync-workflow.ps1 push-develop
```

You'll be prompted for a commit message. The code will be pushed to the `develop` branch.

**Your partner's device will auto-sync within 5 minutes.**

### 2. Reviewing on Your Partner's Device

Your partner's auto-sync script runs continuously and will:
- Check for changes every 5 minutes
- Pull code from `develop` branch
- Rebuild Docker containers automatically
- Log all changes to `auto-sync.log`

### 3. Confirming Changes (Production)

Once you've tested on both devices and everything works, promote to `main`:

```powershell
powershell -ExecutionPolicy Bypass -File sync-workflow.ps1 promote-to-main
```

You'll be asked to confirm. Type `YES` to merge `develop` → `main`.

When you promote to main, both devices should update to the stable version.

## Available Commands

### On Your Device

```powershell
# Check current status
powershell -ExecutionPolicy Bypass -File sync-workflow.ps1 status

# Push changes to develop (partner auto-syncs)
powershell -ExecutionPolicy Bypass -File sync-workflow.ps1 push-develop

# Promote develop to main (requires confirmation)
powershell -ExecutionPolicy Bypass -File sync-workflow.ps1 promote-to-main

# Rebuild Docker containers locally
powershell -ExecutionPolicy Bypass -File sync-workflow.ps1 rebuild
```

### On Partner's Device

```powershell
# Start auto-sync service (runs every 5 minutes)
powershell -ExecutionPolicy Bypass -File auto-sync-partner.ps1

# View sync logs
type auto-sync.log
```

## Manual Update on Partner's Device

If your partner needs to manually pull the latest changes:

```powershell
cd C:\CODE\PulseService
git fetch origin
git checkout develop
git pull origin develop
docker-compose down
docker-compose up -d --build
```

## Troubleshooting

### Auto-sync not working on partner's device
1. Check if `auto-sync-partner.ps1` is still running
2. Check `auto-sync.log` for errors
3. Verify git access: `git -C C:\CODE\PulseService fetch origin`
4. Restart the auto-sync script

### Git merge conflict
If merging `develop` to `main` causes conflicts:
1. Cancel the promotion (don't type `YES`)
2. Manually resolve conflicts in your editor
3. Commit and push
4. Try promotion again

### Docker won't rebuild
1. Stop all containers: `docker-compose down`
2. Rebuild: `docker-compose up -d --build`
3. Check logs: `docker-compose logs`

## Current Setup

- **Your Device**: `C:\CODE\PulseService` (main branch)
- **Partner Device**: Auto-syncs to `develop` branch
- **Sync Interval**: 5 minutes
- **API**: `http://10.4.4.23:3000`
- **Frontend**: `http://10.4.4.23:8080`

## Tips

- Keep commits small and focused
- Use clear commit messages
- Test on `develop` before promoting to `main`
- Check `auto-sync.log` on partner's device to confirm changes are being synced
- Both devices can make changes to `develop`, they'll sync automatically
- Only you can promote to `main` to avoid conflicts
