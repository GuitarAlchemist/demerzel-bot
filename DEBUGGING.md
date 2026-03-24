# Demerzel Bot Debugging Guide

## Current Issue: API Credit Balance Error

The bot is returning: **"Your credit balance is too low to access the Anthropic API"**

### Root Causes (in order of likelihood)

1. **Outdated SDK version (0.80.0)**
   - The `@anthropic-ai/sdk` version in package.json is very old and predates the Sonnet 4-20250514 model
   - This can cause API compatibility issues or billing/quota detection problems
   - **Fix:** Upgrade to latest version

2. **API Key Quota Exceeded**
   - The API key account has exhausted free tier credits or monthly billing quota
   - **Fix:** Check https://console.anthropic.com/account/limits for billing status

3. **Model Not Available**
   - The API key's account tier doesn't support claude-sonnet-4-20250514
   - **Fix:** Use an older model like claude-3-5-sonnet-20241022

### Quick Fixes Applied (2026-03-24)

✅ **Fallback Model Logic:** Bot now tries claude-3-5-sonnet-20241022 if Sonnet 4 fails
✅ **Enhanced Error Logging:** Full error object is now logged to console
✅ **Better Error Messages:** Detects "credit"/"quota"/"balance" errors and points to billing console

### Next Steps

1. **Upgrade the SDK (CRITICAL)**
   ```bash
   npm install @anthropic-ai/sdk@latest
   ```
   This brings support for newer models and better API compatibility.

2. **Test the API Key**
   Run a manual test:
   ```bash
   node -e "
   require('dotenv').config();
   const { default: Anthropic } = require('@anthropic-ai/sdk');
   const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
   anthropic.messages.create({
     model: 'claude-3-5-sonnet-20241022',
     max_tokens: 100,
     messages: [{ role: 'user', content: 'hello' }]
   }).then(r => console.log('✓ API works')).catch(e => console.error('✗ Error:', e.message));
   "
   ```

3. **Check Billing**
   - Visit https://console.anthropic.com/account/limits
   - Verify the API key has credits/usage remaining
   - Check if the account tier supports the requested models

4. **Verify API Key**
   - Is the `.env` API key the same one you're currently using in Claude Code?
   - Or is it a separate account with a different credit situation?

## Files Modified

- `src/bot.js` — Added fallback model + enhanced error logging (2026-03-24)
- `DEBUGGING.md` — This file

## Configuration

**Bot Config Location:** `C:\Users\spare\source\repos\demerzel-bot\`

- `.env` — Discord token + Anthropic API key (not in repo)
- `package.json` — Dependencies (note: SDK version is old)
- `src/bot.js` — Main entry point

## Model Versions

| Model | Status | Year |
|-------|--------|------|
| claude-sonnet-4-20250514 | Primary (may fail) | 2025 |
| claude-3-5-sonnet-20241022 | Fallback (stable) | 2024 |

The fallback model is well-tested and available on most Anthropic accounts.

## Logging

Run the bot with explicit logging:
```bash
npm run dev
```

Watch for:
- `Primary model [...] failed:` — means Sonnet 4 failed, watch for fallback success
- `✓ Fallback model succeeded` — fallback worked, bot will respond
- `Claude API error:` — full error message with details
- `Full error:` — complete error object for debugging
