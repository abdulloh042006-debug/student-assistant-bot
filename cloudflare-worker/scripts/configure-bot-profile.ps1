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

function Invoke-TelegramJson {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][hashtable]$Payload
    )
    $uri = "https://api.telegram.org/bot$script:BotToken/$Method"
    $json = ConvertTo-Json -InputObject $Payload -Depth 10 -Compress
    $response = Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ErrorAction Stop
    if (-not $response.ok) {
        throw "Telegram method failed: $Method"
    }
    return $response
}

$script:BotToken = Read-PlainSecret "Telegram BOT_TOKEN"
if ([string]::IsNullOrWhiteSpace($script:BotToken)) {
    Write-Host "ERROR: BOT_TOKEN cannot be empty."
    exit 1
}

$shortDescription = "Talabalar uchun elektron topshiriq buyurtmalari, fayl yuborish va buyurtma holatini kuzatish."
$description = @"
Assalomu alaykum! Student Assistant - talabalar uchun elektron topshiriqlar bo'yicha buyurtma boti.

- Prezentatsiya, referat va boshqa elektron ishlar uchun buyurtma qoldiring.
- Kerakli fayllarni biriktiring.
- Buyurtma holatini kuzating.
- To'lov cheki va kerakli hujjatlarni yuboring.

Yakuniy narx va muddat administrator tasdig'idan keyin belgilanadi.
"@.Trim()

try {
    $me = Invoke-RestMethod -Method Get -Uri ("https://api.telegram.org/bot" + $script:BotToken + "/getMe") -ErrorAction Stop
    if (-not $me.ok) {
        throw "Bot token validation failed."
    }
    Write-Host ("Bot verified: @{0}" -f $me.result.username)

    Invoke-TelegramJson -Method "setMyShortDescription" -Payload @{
        short_description = $shortDescription
    } | Out-Null

    Invoke-TelegramJson -Method "setMyDescription" -Payload @{
        description = $description
    } | Out-Null

    Invoke-TelegramJson -Method "setMyCommands" -Payload @{
        commands = @(
            @{ command = "start"; description = "Botni ishga tushirish" },
            @{ command = "cancel"; description = "Joriy amalni bekor qilish" }
        )
    } | Out-Null

    Write-Host "SUCCESS: short description, full description, and bot commands are configured."
}
catch {
    Write-Host "ERROR while configuring bot text. Check the token and internet connection. Credential details are hidden."
    $script:BotToken = $null
    exit 1
}

$photoPath = Read-Host "Optional bot logo JPG full path (press Enter to skip)"
if (-not [string]::IsNullOrWhiteSpace($photoPath)) {
    $photoPath = $photoPath.Trim().Trim('"')
    if (-not (Test-Path -LiteralPath $photoPath -PathType Leaf)) {
        Write-Host "TEXT SUCCESS, PHOTO SKIPPED: the selected file was not found."
    }
    elseif ([IO.Path]::GetExtension($photoPath).ToLowerInvariant() -notin @(".jpg", ".jpeg")) {
        Write-Host "TEXT SUCCESS, PHOTO SKIPPED: use a JPG or JPEG file."
    }
    else {
        $client = $null
        $multipart = $null
        $fileStream = $null
        try {
            Add-Type -AssemblyName System.Net.Http
            $client = [System.Net.Http.HttpClient]::new()
            $multipart = [System.Net.Http.MultipartFormDataContent]::new()
            $photoSpec = '{"type":"static","photo":"attach://profile_photo"}'
            $photoJson = [System.Net.Http.StringContent]::new($photoSpec, [Text.Encoding]::UTF8, "application/json")
            $multipart.Add($photoJson, "photo")

            $fileStream = [IO.File]::OpenRead($photoPath)
            $fileContent = [System.Net.Http.StreamContent]::new($fileStream)
            $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("image/jpeg")
            $multipart.Add($fileContent, "profile_photo", [IO.Path]::GetFileName($photoPath))

            $photoUri = "https://api.telegram.org/bot$script:BotToken/setMyProfilePhoto"
            $httpResponse = $client.PostAsync($photoUri, $multipart).GetAwaiter().GetResult()
            $responseText = $httpResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            $photoResponse = ConvertFrom-Json $responseText
            if (-not $httpResponse.IsSuccessStatusCode -or -not $photoResponse.ok) {
                throw "Telegram rejected profile photo upload."
            }
            Write-Host "SUCCESS: bot profile logo updated."
        }
        catch {
            Write-Host "TEXT SUCCESS, PHOTO FAILED: check the JPG file and Telegram profile-photo API support."
        }
        finally {
            if ($fileStream) { $fileStream.Dispose() }
            if ($multipart) { $multipart.Dispose() }
            if ($client) { $client.Dispose() }
        }
    }
}
else {
    Write-Host "Profile photo unchanged; logo upload was skipped."
}

$script:BotToken = $null
