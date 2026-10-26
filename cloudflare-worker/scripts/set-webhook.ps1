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

$workerUrl = (Read-Host "Worker URL (masalan https://student-assistant-bot.<subdomain>.workers.dev)").Trim().TrimEnd("/")
if ($workerUrl -notmatch '^https://[^/]+$') {
    Write-Error "Worker URL HTTPS bo‘lishi kerak va path kiritilmasin."
    exit 1
}

$token = Read-PlainSecret "Telegram BOT_TOKEN"
$secret = Read-PlainSecret "Cloudflare WEBHOOK_SECRET (Worker secret bilan bir xil)"
if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Error "BOT_TOKEN bo‘sh bo‘lmasin."
    exit 1
}
if ($secret -notmatch '^[A-Za-z0-9_-]{32,256}$') {
    Write-Error "WEBHOOK_SECRET 32–256 belgi, faqat harf, raqam, _ yoki - dan iborat bo‘lsin."
    exit 1
}

$uri = "https://api.telegram.org/bot$token/setWebhook"
$body = @{
    url = "$workerUrl/telegram"
    secret_token = $secret
    allowed_updates = @("message", "callback_query")
    drop_pending_updates = $false
} | ConvertTo-Json -Compress

try {
    $result = Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $body
    if (-not $result.ok) {
        Write-Error "Telegram webhook sozlamadi. BotFather tokeni va Worker URLni tekshiring."
        exit 1
    }
    Write-Output "Webhook muvaffaqiyatli sozlandi: $workerUrl/telegram"
}
catch {
    Write-Error "Webhook sozlanmadi. Token, internet va Worker URLni tekshiring; xato tafsilotlari maxfiy URLni oshkor qilmasligi uchun yashirildi."
    exit 1
}
finally {
    $token = $null
    $secret = $null
    $body = $null
    $uri = $null
}
