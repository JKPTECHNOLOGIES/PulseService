# Partner Device Setup Guide

This guide walks through setting up your device to auto-sync with the main development device.

## Prerequisites

Ensure you have installed:
- **Git**: https://git-scm.com/download/win
- **Docker Desktop**: https://www.docker.com/products/docker-desktop
- **PowerShell 5.0+** (usually built into Windows)

## Step 1: Clone the Repository

Open PowerShell and run:

```powershell
cd C:\CODE
git clone https://github.com/JKPTECHNOLOGIES/PulseService.git
cd PulseService
git checkout develop
```

## Step 2: Verify Docker is Running

```powershell
docker --version
docker-compose --version
```

## Step 3: Start Auto-Sync

The auto-sync script will continuously pull changes from the `develop` branch and rebuild Docker containers.

```powershell
cd C:\CODE\PulseService
powershell -ExecutionPolicy Bypass -File auto-sync-partner.ps1
```

**Leave this running in the background!**

You should see output like:
```
[2024-06-30 14:35:20] Auto-sync service started for branch: develop
[2024-06-30 14:35:20] Sync interval: 300 seconds
```

## Step 4: Monitor Sync Status

While the auto-sync script is running, you can check the logs in another PowerShell window:

```powershell
cd C:\CODE\PulseService
Get-Content auto-sync.log -Tail 20 -Wait
```

This will show you real-time sync updates.

## Step 5: Access the Application

Once Docker containers are running, access the app at:

```
http://localhost:8080
```

Or from another device on your network:

```
http://<your-computer-ip>:8080
```

## What Happens Automatically

Every 5 minutes, the auto-sync script will:

1. Check if the main device has pushed changes to `develop`
2. If changes exist:
   - Pull the latest code
   - Rebuild Docker containers
   - Restart services
3. Log all activity to `auto-sync.log`

## Manual Commands

If you need to manually update:

```powershell
cd C:\CODE\PulseService
git fetch origin
git pull origin develop
docker-compose down
docker-compose up -d --build
```

## Login Credentials

Once the app is running, log in with:

- **Email**: `admin@pulseservice.com`
- **Password**: `admin123`

Or dispatcher/technician accounts:
- **Email**: `dispatcher@pulseservice.com`
- **Password**: `pass123`

## Stopping Auto-Sync

Press `Ctrl+C` in the PowerShell window running `auto-sync-partner.ps1`

## Troubleshooting

### Docker containers won't start
```powershell
docker-compose logs
```

### Git access denied
Make sure you have Git credentials configured:
```powershell
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### Still on wrong branch
```powershell
git checkout develop
```

### Need to manually sync now
```powershell
powershell -ExecutionPolicy Bypass -File auto-sync-partner.ps1
```
Then press Ctrl+C when done testing.

## Next Steps

1. Keep the auto-sync script running
2. Check `auto-sync.log` periodically to see when changes are pulled
3. Test changes on your device
4. Communicate with main device about any issues
5. When ready, main device will promote changes to `main` branch

## Need Help?

Check `SYNC-WORKFLOW.md` for detailed workflow information.
