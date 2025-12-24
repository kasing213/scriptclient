#!/usr/bin/env pwsh
# Payment Screenshot Manager
# Usage: .\check-screenshots.ps1 [verify|reject|pending|all|download]

param(
    [string]$Action = "all",
    [string]$Token = $env:SCREENSHOT_DOWNLOAD_TOKEN
)

$BASE_URL = "https://scriptclient-production.up.railway.app/screenshots"

# Check if token is provided
if (-not $Token) {
    Write-Host "❌ Error: SCREENSHOT_DOWNLOAD_TOKEN not set" -ForegroundColor Red
    Write-Host "Set it with: `$env:SCREENSHOT_DOWNLOAD_TOKEN='your-token'" -ForegroundColor Yellow
    Write-Host "Or pass it: .\check-screenshots.ps1 -Token 'your-token'" -ForegroundColor Yellow
    exit 1
}

function Get-ScreenshotCount {
    param([string]$Status)

    try {
        $response = Invoke-RestMethod -Headers @{ "x-download-token" = $Token } -Uri "$BASE_URL/$Status" -ErrorAction Stop
        return $response
    } catch {
        Write-Host "❌ Failed to fetch $Status`: $_" -ForegroundColor Red
        return $null
    }
}

function Show-Summary {
    Write-Host "`n📊 Payment Screenshots Summary" -ForegroundColor Cyan
    Write-Host "================================`n" -ForegroundColor Cyan

    $verified = Get-ScreenshotCount "verified"
    $rejected = Get-ScreenshotCount "rejected"
    $pending = Get-ScreenshotCount "pending"

    if ($verified) {
        Write-Host "✅ Verified:  $($verified.count) screenshots" -ForegroundColor Green
        if ($verified.count -gt 0) {
            $verified.files | ForEach-Object { Write-Host "   - $_" -ForegroundColor Gray }
        }
    }

    if ($rejected) {
        Write-Host "`n❌ Rejected:  $($rejected.count) screenshots" -ForegroundColor Red
        if ($rejected.count -gt 0) {
            $rejected.files | ForEach-Object { Write-Host "   - $_" -ForegroundColor Gray }
        }
    }

    if ($pending) {
        Write-Host "`n⏳ Pending:   $($pending.count) screenshots" -ForegroundColor Yellow
        if ($pending.count -gt 0) {
            $pending.files | ForEach-Object { Write-Host "   - $_" -ForegroundColor Gray }
        }
    }

    $total = ($verified.count + $rejected.count + $pending.count)
    Write-Host "`n📦 Total: $total screenshots collected`n" -ForegroundColor Cyan
}

function Download-Screenshots {
    param([string]$Status)

    Write-Host "`n📥 Downloading $Status screenshots..." -ForegroundColor Cyan

    $response = Get-ScreenshotCount $Status
    if (-not $response -or $response.count -eq 0) {
        Write-Host "No files to download in $Status folder" -ForegroundColor Yellow
        return
    }

    # Create local folder
    New-Item -ItemType Directory -Force -Path $Status | Out-Null

    # Download each file
    foreach ($file in $response.files) {
        Write-Host "  Downloading $file..." -ForegroundColor Gray
        try {
            Invoke-WebRequest `
                -Headers @{ "x-download-token" = $Token } `
                -Uri "$BASE_URL/$Status/$file" `
                -OutFile "$Status\$file" `
                -ErrorAction Stop
        } catch {
            Write-Host "  ❌ Failed to download $file`: $_" -ForegroundColor Red
        }
    }

    Write-Host "✅ Downloaded $($response.count) files to .\$Status\" -ForegroundColor Green
}

# Main logic
switch ($Action.ToLower()) {
    "verified" {
        $response = Get-ScreenshotCount "verified"
        Write-Host "`n✅ Verified: $($response.count) files" -ForegroundColor Green
        $response.files | ForEach-Object { Write-Host "   - $_" }
    }
    "rejected" {
        $response = Get-ScreenshotCount "rejected"
        Write-Host "`n❌ Rejected: $($response.count) files" -ForegroundColor Red
        $response.files | ForEach-Object { Write-Host "   - $_" }
    }
    "pending" {
        $response = Get-ScreenshotCount "pending"
        Write-Host "`n⏳ Pending: $($response.count) files" -ForegroundColor Yellow
        $response.files | ForEach-Object { Write-Host "   - $_" }
    }
    "download" {
        Write-Host "`nDownload which folder?" -ForegroundColor Cyan
        Write-Host "1. Verified" -ForegroundColor Green
        Write-Host "2. Rejected" -ForegroundColor Red
        Write-Host "3. Pending" -ForegroundColor Yellow
        Write-Host "4. All" -ForegroundColor Cyan
        $choice = Read-Host "Enter choice (1-4)"

        switch ($choice) {
            "1" { Download-Screenshots "verified" }
            "2" { Download-Screenshots "rejected" }
            "3" { Download-Screenshots "pending" }
            "4" {
                Download-Screenshots "verified"
                Download-Screenshots "rejected"
                Download-Screenshots "pending"
            }
            default { Write-Host "Invalid choice" -ForegroundColor Red }
        }
    }
    default {
        Show-Summary
    }
}
