# Security Best Practices

Learn how to secure your Telegram authentication implementation.

## Table of Contents

- [Overview](#overview)
- [HMAC Verification](#hmac-verification)
- [Replay Attack Prevention](#replay-attack-prevention)
- [Token Security](#token-security)
- [Session Security](#session-security)
- [Environment Security](#environment-security)
- [Network Security](#network-security)
- [Best Practices](#best-practices)

## Overview

The better-auth-telegram plugin implements multiple security layers to protect your authentication flow:

1. **HMAC-SHA-256 Verification** - Ensures data integrity
2. **Timestamp Validation** - Prevents replay attacks
3. **Secure Token Storage** - Protects bot credentials
4. **HTTPS Requirement** - Encrypted communication
5. **Session Management** - Secure user sessions

## HMAC Verification

### How It Works

Every authentication request from Telegram includes an HMAC-SHA-256 hash that proves the data comes from Telegram and hasn't been tampered with.

**Verification Process:**

1. Extract the `hash` from authentication data
2. Create a data check string from remaining fields (sorted alphabetically)
3. Generate secret key: `SHA256(bot_token)`
4. Calculate HMAC-SHA-256 of data check string using secret key
5. Compare calculated hash with provided hash

**Implementation:**

```typescript
// This happens automatically in the plugin
import { createHmac, createHash } from "crypto";

function verifyTelegramAuth(data: TelegramAuthData, botToken: string): boolean {
  const { hash, ...dataWithoutHash } = data;

  // Create data check string
  const dataCheckString = Object.keys(dataWithoutHash)
    .sort()
    .map((key) => `${key}=${dataWithoutHash[key]}`)
    .join("\n");

  // Generate secret key
  const secretKey = createHash("sha256")
    .update(botToken)
    .digest();

  // Calculate HMAC
  const hmac = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return hmac === hash;
}
```

### Security Implications

- **Prevents data tampering** - Any modification to the data will fail verification
- **Authenticates source** - Proves the data came from Telegram
- **Protects bot token** - Token is never sent to the client

## Replay Attack Prevention

### The Problem

An attacker could intercept a valid authentication request and replay it later to gain unauthorized access.

### The Solution

The plugin validates the `auth_date` timestamp:

```typescript
telegram({
  maxAuthAge: 86400, // 24 hours in seconds
})
```

**How it works:**

```typescript
const authDate = data.auth_date;
const currentTime = Math.floor(Date.now() / 1000);

if (currentTime - authDate > maxAuthAge) {
  throw new Error("Authentication data is too old");
}
```

### Recommendations

Choose `maxAuthAge` based on your security requirements:

| Use Case | Recommended Value | Reasoning |
|----------|-------------------|-----------|
| High Security (Banking) | 3600 (1 hour) | Minimize replay window |
| Standard (SaaS) | 86400 (24 hours) | Balance security and UX |
| Relaxed (Social) | 259200 (3 days) | Better user experience |

**Example:**

```typescript
// High security configuration
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  maxAuthAge: 3600, // 1 hour
})
```

## Token Security

### Bot Token Protection

Your Telegram bot token is highly sensitive. If compromised, an attacker can:
- Impersonate your bot
- Read all messages sent to your bot
- Send messages as your bot

### Best Practices

#### 1. Environment Variables

**Never hardcode tokens:**

```typescript
// ❌ WRONG
telegram({
  botToken: "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
  botUsername: "my_bot",
})

// ✅ CORRECT
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
})
```

#### 2. Secure Storage

Store tokens in environment files that are:
- **Excluded from version control** (add to `.gitignore`)
- **Encrypted at rest** (use secrets management)
- **Access-controlled** (limit who can view)

**.gitignore:**

```
.env
.env.local
.env.*.local
```

#### 3. Rotation

Rotate bot tokens periodically:

1. Create a new bot or regenerate token with @BotFather
2. Update production environment variables
3. Deploy changes
4. Revoke old token

#### 4. Secrets Management

Use secrets management services in production:

**Vercel:**

```bash
vercel env add TELEGRAM_BOT_TOKEN
```

**AWS Secrets Manager:**

```typescript
import { SecretsManager } from "aws-sdk";

const secrets = new SecretsManager();
const { SecretString } = await secrets.getSecretValue({
  SecretId: "telegram/bot-token"
}).promise();
```

**Environment Variables (Docker):**

```dockerfile
# Dockerfile
ENV TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
```

```bash
docker run -e TELEGRAM_BOT_TOKEN="your_token" myapp
```

## Session Security

### Secure Session Configuration

```typescript
export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET!, // Strong secret
  session: {
    expiresIn: 60 * 60 * 24 * 7,    // 7 days
    updateAge: 60 * 60 * 24,        // Update daily
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,               // 5 minutes
    },
  },
  advanced: {
    cookieSameSite: "lax",          // CSRF protection
    useSecureCookies: true,         // HTTPS only
  },
});
```

### Session Best Practices

#### 1. Use Strong Secrets

Generate cryptographically secure secrets:

```bash
openssl rand -hex 32
```

Should produce something like:
```
9397a91a6e8fad71479c38f4a011b4a70ac92236c17c649c0e9567c2e21eef83
```

#### 2. Appropriate Session Length

Balance security and user experience:

**High Security:**
```typescript
session: {
  expiresIn: 60 * 15,        // 15 minutes
  updateAge: 60 * 5,         // 5 minutes
}
```

**Standard Security:**
```typescript
session: {
  expiresIn: 60 * 60 * 24 * 7,   // 7 days
  updateAge: 60 * 60 * 24,       // 1 day
}
```

#### 3. Secure Cookies

Always use secure cookie settings in production:

```typescript
advanced: {
  useSecureCookies: process.env.NODE_ENV === "production",
  cookieSameSite: "lax",
  cookieDomain: undefined, // Auto-detect
}
```

#### 4. Session Invalidation

Implement proper sign-out:

```typescript
const handleSignOut = async () => {
  await authClient.signOut();
  // Clear any client-side state
  // Redirect to home page
  router.push("/");
};
```

## Environment Security

### Development vs Production

**Development (.env.local):**

```env
TELEGRAM_BOT_TOKEN="test_token"
TELEGRAM_BOT_USERNAME="test_bot"
BETTER_AUTH_SECRET="dev-secret-not-for-production"
BETTER_AUTH_URL="https://abc123.ngrok-free.app"
NODE_ENV="development"
```

**Production (.env.production):**

```env
TELEGRAM_BOT_TOKEN="prod_token_from_secrets_manager"
TELEGRAM_BOT_USERNAME="prod_bot"
BETTER_AUTH_SECRET="very-long-cryptographically-secure-secret"
BETTER_AUTH_URL="https://yourdomain.com"
NODE_ENV="production"
```

### Environment File Security

1. **Never commit to git:**

```gitignore
.env
.env.local
.env.*.local
.env.production
```

2. **Use separate bots for dev/prod:**

- Development bot: Limited, test data only
- Production bot: Production domain only

3. **Validate environment variables:**

```typescript
// lib/env.ts
const requiredEnvVars = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "BETTER_AUTH_SECRET",
] as const;

for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
}
```

## Network Security

### HTTPS Requirement

Telegram **requires HTTPS** for authentication widgets. This is non-negotiable.

#### Production

Use proper SSL certificates:

- **Vercel/Netlify**: Automatic HTTPS
- **Custom domain**: Use Let's Encrypt or Cloudflare
- **Load balancer**: Configure SSL termination

#### Development

Use ngrok or similar tunneling service:

```bash
# Install ngrok
npm install -g ngrok

# Start tunnel
ngrok http 3000

# Use the HTTPS URL
https://abc123.ngrok-free.app
```

### Domain Configuration

Set domain with @BotFather:

1. Send `/setdomain` to @BotFather
2. Select your bot
3. Enter your domain (without `https://`)

**Security implications:**

- Prevents unauthorized domains from using your bot
- Ensures widgets only work on your domain
- Protects against domain hijacking

### CORS Configuration

If your API is on a different domain than your frontend:

```typescript
// In your API route
export const auth = betterAuth({
  // ... config
  advanced: {
    cors: {
      origin: ["https://yourdomain.com"],
      credentials: true,
    },
  },
});
```

## Best Practices

### 1. Validate All Inputs

Even though the plugin handles verification, always validate on your end:

```typescript
// Before processing authentication data
if (!authData.id || !authData.first_name || !authData.hash) {
  throw new Error("Invalid authentication data");
}
```

### 2. Rate Limiting

Implement rate limiting on authentication endpoints:

```typescript
import rateLimit from "express-rate-limit";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: "Too many authentication attempts",
});

app.use("/api/auth/telegram/*", authLimiter);
```

### 3. Logging and Monitoring

Log authentication attempts (but not sensitive data):

```typescript
// ✅ Good logging
console.log("Telegram auth attempt", {
  userId: user.id,
  timestamp: new Date(),
  success: true,
});

// ❌ Bad logging (don't log tokens or hashes)
console.log("Auth data:", authData);
```

### 4. Error Messages

Don't leak information in error messages:

```typescript
// ❌ Too specific
if (!verifyHmac(data)) {
  throw new Error("HMAC verification failed with hash mismatch");
}

// ✅ Generic
if (!verifyHmac(data)) {
  throw new Error("Authentication failed");
}
```

### 5. User Account Security

#### Prevent Account Takeover

The plugin prevents linking a Telegram account to multiple users:

```typescript
// This is handled automatically
if (existingAccount && existingAccount.userId !== currentUser.id) {
  throw new Error("This Telegram account is already linked to another user");
}
```

#### Require Re-authentication for Sensitive Actions

```typescript
// Before changing password, email, etc.
const session = await authClient.getSession();
if (!session.data.fresh) {
  // Require user to re-authenticate
  router.push("/re-authenticate");
  return;
}
```

### 6. Database Security

#### Use Parameterized Queries

The Better Auth adapters handle this automatically, but be aware:

```typescript
// ✅ Safe (uses Prisma)
const user = await prisma.user.findUnique({
  where: { telegramId: data.id.toString() }
});

// ❌ Unsafe (raw SQL)
const user = await db.query(
  `SELECT * FROM users WHERE telegramId = '${data.id}'`
);
```

#### Encrypt Sensitive Data

If storing additional sensitive user data:

```typescript
import { encrypt, decrypt } from "./crypto";

// Store encrypted
const encrypted = encrypt(sensitiveData, encryptionKey);
await db.update({ encryptedData: encrypted });

// Read decrypted
const decrypted = decrypt(user.encryptedData, encryptionKey);
```

### 7. Client-Side Security

#### Validate on Client, Verify on Server

```typescript
// Client-side validation
if (!authData.id || !authData.hash) {
  setError("Invalid authentication data");
  return;
}

// Server-side verification (always happens)
const result = await authClient.signInWithTelegram(authData);
```

#### Don't Trust Client Data

Always verify server-side:

```typescript
// ❌ Don't do this
const isAdmin = localStorage.getItem("isAdmin");

// ✅ Verify with server
const session = await authClient.getSession();
const isAdmin = session.data?.user.role === "admin";
```

## Security Checklist

Before going to production:

- [ ] Bot token stored in environment variables (not hardcoded)
- [ ] `.env` files in `.gitignore`
- [ ] Strong `BETTER_AUTH_SECRET` generated with `openssl rand -hex 32`
- [ ] HTTPS enabled in production
- [ ] Domain set with @BotFather
- [ ] `maxAuthAge` configured appropriately
- [ ] Secure cookies enabled (`useSecureCookies: true`)
- [ ] Session expiry configured
- [ ] Rate limiting implemented
- [ ] Error logging (without sensitive data)
- [ ] Database using parameterized queries
- [ ] Separate dev and production bots
- [ ] Secrets management configured
- [ ] CORS configured if needed

## Reporting Security Issues

If you discover a security vulnerability:

1. **Do not** open a public GitHub issue
2. Email: [hello@vcode.sh](mailto:hello@vcode.sh)
3. Include: Description, reproduction steps, potential impact
4. Allow time for fix before public disclosure

## Resources

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Telegram Bot Security](https://core.telegram.org/bots/security)
- [Better Auth Security](https://better-auth.com/docs/security)
- [NIST Password Guidelines](https://pages.nist.gov/800-63-3/)

## Next Steps

- [Troubleshooting](./troubleshooting.md)
- [API Reference](./api-reference.md)
- [Configuration Guide](./configuration.md)
