# AI Trader Bot - Netlify Deployment Guide

## Overview
This guide covers deploying the AI-powered stock trader bot to Netlify as a static site with serverless functions.

## Prerequisites
- Netlify account
- Google Gemini API key
- Git repository (GitHub, GitLab, or Bitbucket)

## Deployment Steps

### 1. Prepare Your Repository
Ensure your project structure looks like this:
```
yahoo_scraper_web/
├── index.html                    # Main static HTML file
├── js/
│   └── trader_bot.js            # Frontend JavaScript
├── netlify/
│   └── functions/
│       └── trader-recommendation.js  # Serverless function
├── netlify.toml                 # Netlify configuration
├── package.json                 # Node.js dependencies
└── DEPLOYMENT.md               # This file
```

### 2. Deploy to Netlify

#### Option A: Git-based Deployment (Recommended)
1. Push your code to a Git repository
2. Log in to [Netlify](https://netlify.com)
3. Click "New site from Git"
4. Connect your repository
5. Configure build settings:
   - **Build command**: `npm install` (or leave empty)
   - **Publish directory**: `.` (current directory)
   - **Functions directory**: `netlify/functions`

#### Option B: Manual Deployment
1. Zip the entire `yahoo_scraper_web` folder
2. Drag and drop to Netlify dashboard
3. Netlify will automatically detect the configuration

### 3. Configure Environment Variables
1. In Netlify dashboard, go to **Site settings** → **Environment variables**
2. Add the following variable:
   - **Key**: `GEMINI_API_KEY`
   - **Value**: `AIzaSyCZmcbPoYKjA9WN15hn7NeGfHSzXfEzAX4`

### 4. Verify Deployment
1. Visit your Netlify site URL
2. Test the trader bot functionality:
   - Enter a stock symbol (e.g., AAPL, TSLA)
   - Select a timeframe
   - Click "Get Recommendation"
   - Verify AI analysis appears

## API Endpoints
- **Main site**: `https://your-site-name.netlify.app/`
- **API function**: `https://your-site-name.netlify.app/.netlify/functions/trader-recommendation`

## Troubleshooting

### Common Issues
1. **Function timeout**: Increase timeout in netlify.toml if needed
2. **CORS errors**: Check headers configuration in netlify.toml
3. **API key issues**: Verify environment variable is set correctly
4. **Build failures**: Check Node.js version compatibility

### Debug Steps
1. Check Netlify function logs in dashboard
2. Test API endpoint directly: `/.netlify/functions/trader-recommendation?symbol=AAPL&timeframe=1mo`
3. Verify environment variables are accessible

## Security Notes
- API key is stored securely as environment variable
- CORS headers are configured for security
- No sensitive data is exposed in frontend code

## Performance
- Static site loads instantly
- Serverless functions scale automatically
- Yahoo Finance API calls are made server-side
- Gemini AI analysis cached per request

## Updates
To update the site:
1. Push changes to your Git repository
2. Netlify will automatically rebuild and deploy
3. No downtime during updates
