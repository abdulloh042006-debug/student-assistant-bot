$ErrorActionPreference = "Stop"

function Read-PlainSecret {
    param([Parameter(Mandatory = $true)][string]$Prompt)
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

$workerUrl = (Read-Host "Worker HTTPS origin, without a path").Trim().TrimEnd("/")
if ($workerUrl -notmatch '^https://[^/]+$') {
    Write-Host "ERROR: Enter an HTTPS origin only, for example https://example.workers.dev"
    exit 1
}

$token = Read-PlainSecret "Telegram BOT_TOKEN"
$secret = Read-PlainSecret "Cloudflare WEBHOOK_SECRET (must match the Worker secret)"
if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host "ERROR: BOT_TOKEN cannot be empty."
    exit 1
}
if ($secret -notmatch '^[A-Za-z0-9_-]{32,256}$') {
    Write-Host "ERROR: WEBHOOK_SECRET must be 32-256 letters, digits, underscores, or hyphens."
    exit 1
}

$step = "token validation"
try {
    $me = Invoke-RestMethod -Method Get -Uri "https://api.telegram.org/bot$token/getMe" -ErrorAction Stop
    if (-not $me.ok) {
        throw "Telegram rejected the token."
    }
    Write-Output "Token accepted for bot @$($me.result.username)"

    $step = "setting webhook"
    $uri = "https://api.telegram.org/bot$token/setWebhook"
    $body = @{
        url = "$workerUrl/telegram"
        secret_token = $secret
        allowed_updates = @("message", "callback_query")
        drop_pending_updates = $false
    } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $body -ErrorAction Stop
    if (-not $result.ok) {
        throw "Telegram did not accept the webhook configuration."
    }

    $step = "verifying webhook"
    $info = Invoke-RestMethod -Method Get -Uri "https://api.telegram.org/bot$token/getWebhookInfo" -ErrorAction Stop
    if ($info.result.url -ne "$workerUrl/telegram") {
        throw "The webhook URL does not match the requested URL."
    }
    Write-Output "SUCCESS: webhook is set to $workerUrl/telegram"
    Write-Output "Pending updates: $($info.result.pending_update_count)"
    if ($info.result.last_error_message) {
        Write-Output "Telegram's latest delivery error: $($info.result.last_error_message)"
    }
}
catch {
    Write-Host "ERROR while $step. Check the token, network, Worker URL, and matching WEBHOOK_SECRET."
    Write-Host "Details are hidden to avoid exposing credentials."
    exit 1
}
finally {
    $token = $null
    $secret = $null
    $body = $null
    $uri = $null
}
