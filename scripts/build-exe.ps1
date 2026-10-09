$sfx = "C:\Program Files\7-Zip\7z.sfx"
$sevenZip = "C:\Program Files\7-Zip\7z.exe"
$app7z = "dist\app.7z"
$outputExe = "dist\Kantin-20260531-Setup-1.0.0.exe"

if (Test-Path $app7z) { Remove-Item $app7z -Force }
& $sevenZip a -mx=9 $app7z ".\dist\win-unpacked\*"

$sfxConfig = @"
;!@Install@!UTF-8!
Title="Kantin Dashboard"
RunProgram="Kantin Dashboard.exe"
;!@InstallEnd@!
"@
[System.IO.File]::WriteAllText("dist\sfx_config.txt", $sfxConfig, [System.Text.Encoding]::UTF8)

cmd /c "copy /b `"$sfx`" + dist\sfx_config.txt + $app7z `"$outputExe`""
Remove-Item dist\sfx_config.txt, $app7z -Force -ErrorAction SilentlyContinue

Write-Host "Build EXE selesai: $outputExe"
