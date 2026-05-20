# Releasing a new version

Two kinds of release:

1. **Hot release** — UI/server/Python code only. Installed users get it via the in-app **Check for updates** button (or automatic check on startup). No reinstall needed.
2. **Full release** — anything else changed (Python deps, ffmpeg, Whisper models, launcher). Users need the new installer `.exe`.

The hot path covers ~90% of changes. Most bug fixes and UI tweaks are hot.

## Hot release (the common case)

From the project root:

```powershell
# 1. Make sure your changes are committed on the prod branch (or merge from main).
# 2. Cut the release:
.\installer\cut-release.ps1 -Version 0.2.0 -Notes "Fix segment seek bug; better speaker colors"
```

What it does:
- Bumps `version.txt` to `0.2.0`
- Runs `npm run build` to produce fresh `dist/` and `dist-server/index.mjs`
- Stages files into `release/ui/`, `release/server/`
- Computes sha256 for each file
- Writes `release/manifest.json` with `kind: "hot"`
- `git add` + `git commit -m "Release v0.2.0"` + `git push origin prod`

Installed users will see the update banner within ~30 seconds of opening the app (on auto-check), or immediately when they click **Check for updates**. Clicking **Install** downloads the new files, verifies hashes, stages them as `.new`, and prompts to restart. The launcher swaps `.new` into place on next launch.

### Flags

```powershell
# Skip pushing (just stage + commit locally):
.\installer\cut-release.ps1 -Version 0.2.1 -NoPush

# Dry run - build artifacts and manifest, no git changes:
.\installer\cut-release.ps1 -Version 0.2.1 -DryRun

# Different release branch:
.\installer\cut-release.ps1 -Version 0.2.1 -Branch main
```

## Full release (when deps change)

When you bump a Python package, swap ffmpeg, change Whisper models, or modify `launch.vbs`/`start.cmd`, hot updates won't carry those changes. Two steps:

```powershell
# 1. Mark the release as full so the app prompts users to download the installer:
.\installer\cut-release.ps1 -Version 0.3.0 -Kind full -Notes "Upgrade to Whisper v4 model"

# 2. Build and publish the new installer .exe to GitHub Releases:
.\installer\build-installer.ps1
& "C:\Users\DanBrewer\AppData\Local\Programs\Inno Setup 6\ISCC.exe" .\installer\installer.iss
gh release create v0.3.0 .\installer\output\VideoTranscribeSetup.exe --notes "Upgrade to Whisper v4 model"
```

`cut-release` auto-fills `installer_url` to `https://github.com/<owner>/<repo>/releases/latest/download/VideoTranscribeSetup.exe`. If you uploaded with a different filename, pass `-InstallerUrl https://...` explicitly.

After both commands, the in-app updater shows users a "This update needs the full installer — Download" button.

## Version numbering

Plain `x.y.z`. Bump:
- `z` — bug fix or small tweak (hot)
- `y` — new feature (hot if no deps changed, otherwise full)
- `x` — breaking change or major rework (always full)

## How users actually receive updates

- **Auto-check on launch** — server hits the manifest URL in the background; banner appears if there's something newer.
- **Manual** — they click **Check for updates** in the app header.
- **Manifest URL** — `https://raw.githubusercontent.com/<owner>/<repo>/prod/release/manifest.json` (cacheable, no auth needed for public repos).

## Safety / trust

Whoever can push to `prod` can ship code that runs on every installed machine. Protect the branch:

```powershell
# In the GitHub repo settings, enable:
#  - Branch protection rule on `prod`
#  - Require pull request reviews before merging
#  - Restrict who can push directly
```

If you ever need to roll back, push a new release with the previous version's files — installed apps don't downgrade automatically, but new installs from the .exe will get whatever the latest installer is.
