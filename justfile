set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# Merge develop into main (pushes, returns to develop; branches are kept), then build and upload changed files
# in dist/ to FTPS_REMOTE_DIR over FTPS (https://gdm.tik-choco.com/worlds/). Flags: --dry --verify --full --prune --verbose
deploy *args:
    if ((git rev-parse --abbrev-ref HEAD) -ne 'develop') { Write-Error 'run deploy from the develop branch'; exit 1 }
    if (git status --porcelain) { Write-Error 'commit your changes first (guru s)'; exit 1 }
    guru merge main; if ($LASTEXITCODE) { exit $LASTEXITCODE }
    if ((git rev-parse --abbrev-ref HEAD) -ne 'develop') { Write-Error 'expected to be back on develop after merge'; exit 1 }
    node scripts/ftps-upload.mjs --build {{args}}

# Store the FTPS password DPAPI-encrypted in %APPDATA%\tc-linkai\ftps.cred (shared with tc-game / tc-linkai)
ftps-login:
    node scripts/ftps-upload.mjs --login
