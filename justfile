set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# Build, then upload changed files in dist/ to FTPS_REMOTE_DIR over FTPS (https://gdm.tik-choco.com/worlds/). Flags: --dry --verify --full --prune --verbose
deploy *args:
    node scripts/ftps-upload.mjs --build {{args}}

# Store the FTPS password DPAPI-encrypted in %APPDATA%\tc-linkai\ftps.cred (shared with tc-game / tc-linkai)
ftps-login:
    node scripts/ftps-upload.mjs --login
