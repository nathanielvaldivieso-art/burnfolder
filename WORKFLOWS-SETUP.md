# GitHub Workflows Setup

Since your GitHub token doesn't have `workflow` scope, you need to add the workflow files manually:

## Option 1: Update Your GitHub Token (Recommended)

1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a name: "Burnfolder Workflows"
4. Select scopes:
   - ✅ `repo` (full control)
   - ✅ `workflow` (update GitHub Actions workflows)
5. Generate and copy the token
6. Update your git credentials:
   ```bash
   git remote set-url origin https://YOUR_NEW_TOKEN@github.com/nathanielvaldivieso-art/burnfolder.git
   ```
7. Then push the workflows:
   ```bash
   git add .github/
   git commit -m "Add GitHub Actions workflows for automated emails"
   git push
   ```

## Option 2: Add Workflows via GitHub Web Interface

1. Go to your repo: https://github.com/nathanielvaldivieso-art/burnfolder
2. Click "Add file" → "Create new file"
3. Name it: `.github/workflows/welcome-email.yml`
4. Copy content from `.github/workflows/welcome-email.yml` (see below)
5. Commit directly to main
6. Repeat for `notify-new-entry.yml`

---

## The workflow files are in your local repo at:
- `.github/workflows/welcome-email.yml`
- `.github/workflows/notify-new-entry.yml`

You can view them and copy/paste into GitHub's web editor.
