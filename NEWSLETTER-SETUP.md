# Burnfolder Newsletter Automation Setup

This repo has automated newsletter functionality. Here's how to complete the setup:

## Setup Steps

### 1. Deploy to Netlify

1. Go to [netlify.com](https://netlify.com)
2. Sign up / log in
3. Click "Add new site" → "Import an existing project"
4. Connect to GitHub and select this repo
5. Deploy settings:
   - Build command: (leave empty)
   - Publish directory: `.`
6. Click "Deploy site"

### 2. Set up SendGrid (Free Email API)

1. Go to [sendgrid.com](https://sendgrid.com)
2. Sign up for free account (100 emails/day forever free)
3. Verify your email
4. Go to Settings → API Keys
5. Create new API key with "Full Access"
6. Copy the API key (you'll need it for both GitHub and Netlify)

### 3. Configure GitHub Secrets

1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add these secrets:
   - Name: `SENDGRID_API_KEY`
   - Value: (paste your SendGrid API key)
   - Name: `GITHUB_TOKEN`
   - Value: (GitHub auto-generates this, or create a Personal Access Token with `repo` scope)

### 4. Configure Netlify Environment Variables

1. In Netlify dashboard → Site settings → Environment variables
2. Add:
   - Key: `GITHUB_TOKEN`
   - Value: (create a GitHub Personal Access Token with `repo` scope)

### 5. How It Works

**When someone subscribes:**
1. User enters email on index.html
2. Netlify function adds email to `subscribers.json`
3. Commits change to GitHub
4. GitHub Action sends welcome email

**When you add a new entry:**
1. Create new file (e.g., `10.29.html`)
2. Add "10.29" to entries array in index.html
3. `git push`
4. GitHub Action detects new file
5. Reads all subscribers from `subscribers.json`
6. Sends notification email to everyone

## Testing

Test the signup form on your live Netlify site. You should receive a welcome email within 1-2 minutes.

## Customizing Email Content

Edit the email templates in:
- `.github/workflows/welcome-email.yml` (welcome email)
- `.github/workflows/notify-new-entry.yml` (new entry notifications)
