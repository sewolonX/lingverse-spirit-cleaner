# LingVerse Spirit Cleaner

LingVerse userscript for Tampermonkey / Violentmonkey.

## Install

Open this raw script URL in your browser extension:

https://raw.githubusercontent.com/SuRanHF/lingverse-spirit-cleaner/main/lingverse-spirit-cleaner.user.js

## Updates

The script metadata includes `@updateURL` and `@downloadURL`, so script managers can detect newer versions automatically.

When publishing a new version:

1. Update `@version` and `SCRIPT_VERSION` in `lingverse-spirit-cleaner.user.js`.
2. Update `release.json` with the same version and release notes.
3. Commit and push to `main`.

Double-click `一键发布.bat` to publish interactively. It asks for the new version and release notes, then updates files, commits, pushes, and verifies GitHub raw URLs.

Or run the publish script from PowerShell:

```powershell
.\publish.ps1 -Message "Publish v0.9.6"
```

Interactive PowerShell mode:

```powershell
.\publish.ps1 -Interactive
```

The script checks version consistency, validates JavaScript syntax when Node.js is available, commits the changed files, pushes to GitHub, and verifies the raw GitHub URLs.
