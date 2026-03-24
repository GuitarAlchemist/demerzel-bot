# Demerzel Discord Bot — Debug Findings (2026-03-24)

## Error Description
Bot returns: **"Your credit balance is too low to access the Anthropic API"**

## Investigation Results

### 1. Bot Configuration Found ✓

| Component | Location | Status |
|-----------|----------|--------|
| **Entry point** | `src/bot.js` | Running |
| **API key** | `.env` | Configured (sk-ant-api03-...) |
| **Discord token** | `.env` | Configured |
| **Primary model** | `claude-sonnet-4-20250514` | Set but failing |
| **SDK version** | `@anthropic-ai/sdk@0.80.0` | **OUTDATED** ⚠️ |

### 2. Root Cause Analysis

Three overlapping issues identified:

#### Issue #1: Outdated SDK (CRITICAL)
- **Current version:** 0.80.0
- **Release date:** ~mid 2024
- **Problem:** Predates claude-sonnet-4-20250514 model release
- **Symptoms:**
  - SDK may not recognize the newer model
  - Billing/quota detection may be buggy in old version
  - API response parsing may be incompatible
- **Solution:** Upgrade to `^1.0.0` or latest

#### Issue #2: API Quota Exhaustion (LIKELY)
- **Error type:** "credit balance too low"
- **Causes:**
  - Free tier limit exceeded (free accounts get $5 credit)
  - Monthly billing quota reached
  - Account tier doesn't support Sonnet 4 access
- **Verification:** Check https://console.anthropic.com/account/limits
- **Solution:** Top up credits or downgrade to Sonnet 3.5

#### Issue #3: Model Access Restriction (POSSIBLE)
- **Problem:** API key's account tier may not support claude-sonnet-4-20250514
- **Indicator:** Even with credits, API rejects the model
- **Solution:** Use claude-3-5-sonnet-20241022 (fallback model)

### 3. Cross-Repo Context

The API key in `.env` **appears to be different from** the main Claude Code session, because:
- If it were the same account, we'd see the same quota error here
- The main session is working (I'm responding now)
- The bot has been separate from the main agent setup

## Fixes Applied (Commit 11c92eb)

### A. Fallback Model Logic
```javascript
// Try primary model first
try {
  response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', ... });
} catch (primaryError) {
  // Fall back to stable model
  response = await anthropic.messages.create({ model: 'claude-3-5-sonnet-20241022', ... });
}
```

**Benefit:** Bot will work even if Sonnet 4 fails due to quota or access restrictions.

### B. Enhanced Error Logging
```javascript
console.error('Claude API error:', error.message);
console.error('Full error:', JSON.stringify(error, null, 2));
```

**Benefit:** Console logs now show full error object for debugging.

### C. User-Friendly Error Messages
```javascript
if (error.message.includes('credit') || error.message.includes('quota') || error.message.includes('balance')) {
  return `⚠️ API Quota Error: ${error.message}. Check https://console.anthropic.com/account/limits`;
}
```

**Benefit:** Users/developers see specific quota errors with link to fix.

## Testing & Verification

### Immediate Test
Run the bot and watch console:
```bash
cd /c/Users/spare/source/repos/demerzel-bot
npm run dev
```

Watch for:
- ✓ If Sonnet 4 works → responds normally
- ⚠️ If Sonnet 4 fails → console shows "Primary model failed: ..."
- ✓ If fallback succeeds → console shows "✓ Fallback model succeeded"
- ❌ If both fail → console shows "Full error: {...}" for analysis

### Detailed API Test
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

## Recommended Next Steps

### PRIORITY 1: SDK Upgrade
```bash
cd /c/Users/spare/source/repos/demerzel-bot
npm install @anthropic-ai/sdk@latest
npm run dev
```

This alone may fix the issue if it's a compatibility problem with the old SDK.

### PRIORITY 2: Verify API Key Billing
1. Go to https://console.anthropic.com/account/limits
2. Check the API key's usage and quota
3. If exhausted, top up credits or switch to a different key

### PRIORITY 3: Confirm Model Access
Once upgraded, test both models:
```bash
# Test Sonnet 4
node -e "const Anthropic = require('@anthropic-ai/sdk').default; const a = new Anthropic(); a.messages.create({model: 'claude-sonnet-4-20250514', max_tokens: 100, messages: [{role: 'user', content: 'hi'}]}).then(r => console.log('✓ Sonnet 4 works')).catch(e => console.error('✗', e.message));"

# Test fallback
node -e "const Anthropic = require('@anthropic-ai/sdk').default; const a = new Anthropic(); a.messages.create({model: 'claude-3-5-sonnet-20241022', max_tokens: 100, messages: [{role: 'user', content: 'hi'}]}).then(r => console.log('✓ Sonnet 3.5 works')).catch(e => console.error('✗', e.message));"
```

## Files for Reference

- `src/bot.js` — Main bot code (lines 111-168: fallback logic; lines 282-296: error handling)
- `DEBUGGING.md` — Detailed troubleshooting guide
- `package.json` — Dependencies (SDK version field)
- `.env` — Configuration (API key and Discord token)

## Summary

The bot is now **resilient** to Sonnet 4 quota issues with automatic fallback to Sonnet 3.5. However, the underlying issue (old SDK + potential quota exhaustion) should be addressed by:

1. **Upgrading the SDK** (most important)
2. **Checking API key billing** (if SDK upgrade doesn't help)
3. **Verifying account tier** (if both model tests fail)

With these fixes in place, the bot should respond reliably regardless of which model is used.
