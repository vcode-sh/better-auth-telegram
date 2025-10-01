# better-auth-telegram Documentation

Complete documentation for the Telegram authentication plugin for Better Auth.

## Table of Contents

### Getting Started

- **[Installation Guide](./installation.md)** - Complete setup instructions from bot creation to deployment
  - Create Telegram bot with @BotFather
  - Configure Better Auth server and client
  - Database schema setup
  - Local development with ngrok

### Usage

- **[Usage Guide](./usage.md)** - Common usage patterns and examples
  - Basic sign-in flow
  - Sign-in with redirect
  - Link/unlink Telegram accounts
  - Session management
  - Framework-specific examples

- **[Mini Apps Guide](./miniapps.md)** - **🆕 NEW in v0.2.0**
  - Complete Telegram Mini Apps implementation
  - Auto-authentication setup
  - Step-by-step bot creation
  - Testing with ngrok
  - Full working examples
  - Troubleshooting guide

### Reference

- **[API Reference](./api-reference.md)** - Complete API documentation
  - Server plugin configuration
  - Client methods
  - Endpoints
  - Types and interfaces
  - Schema extensions

- **[Configuration Guide](./configuration.md)** - Detailed configuration options
  - Server and client setup
  - Environment variables
  - Widget customization
  - User data mapping
  - Session configuration
  - Database configuration
  - Framework-specific configs

### Security

- **[Security Best Practices](./security.md)** - How to secure your implementation
  - HMAC verification
  - Replay attack prevention
  - Token security
  - Session security
  - Environment security
  - Network security (HTTPS, CORS)
  - Security checklist

### Support

- **[Troubleshooting Guide](./troubleshooting.md)** - Solutions to common problems
  - Widget issues
  - Authentication errors
  - Session problems
  - Database issues
  - Environment and configuration
  - Development and production issues

## Quick Links

- [GitHub Repository](https://github.com/vcode-sh/better-auth-telegram)
- [Better Auth Documentation](https://better-auth.com)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Login Widget](https://core.telegram.org/widgets/login)

## Quick Start

### 1. Install

```bash
npm install better-auth-telegram
```

### 2. Create Bot

Message [@BotFather](https://t.me/botfather) on Telegram and run `/newbot`

### 3. Configure Server

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: /* your database config */,
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: "your_bot_username",
    }),
  ],
});
```

### 4. Configure Client

```typescript
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [telegramClient()],
});
```

### 5. Use in Your App

```tsx
import { authClient } from "./auth-client";
import { useEffect } from "react";

export function LoginButton() {
  useEffect(() => {
    authClient.initTelegramWidget(
      "telegram-login",
      { size: "large" },
      async (authData) => {
        await authClient.signInWithTelegram(authData);
      }
    );
  }, []);

  return <div id="telegram-login"></div>;
}
```

## Features

- ✅ Sign in with Telegram Login Widget
- ✅ **NEW: Telegram Mini Apps support** (v0.2.0+)
- ✅ Link/unlink Telegram accounts
- ✅ HMAC-SHA-256 verification
- ✅ Replay attack prevention
- ✅ Customizable widget
- ✅ Auto-authentication in Mini Apps
- ✅ Access to premium status, language, and more
- ✅ Full TypeScript support
- ✅ Framework-agnostic
- ✅ Works with all Better Auth adapters

## Supported Frameworks

- Next.js (App Router & Pages Router)
- React
- Vue
- Svelte
- Vanilla JavaScript
- Any framework that supports Better Auth

## Supported Databases

- PostgreSQL
- MySQL
- SQLite
- MongoDB (via Prisma)
- Any database supported by Better Auth

## Requirements

- Node.js 22+ (recommended: 22.x or 24.x)
- Better Auth v1.0.0+
- HTTPS (required by Telegram)
- Public domain (use ngrok for local dev)

## Documentation Structure

```
docs/
├── README.md              # This file - documentation index
├── installation.md        # Complete installation guide
├── usage.md              # Usage examples and patterns
├── miniapps.md           # 🆕 Mini Apps complete guide (v0.2.0+)
├── api-reference.md      # Complete API documentation
├── configuration.md      # Configuration options
├── security.md           # Security best practices
└── troubleshooting.md    # Common issues and solutions
```

## Example Projects

See the `examples/` directory for complete implementations:

- `nextjs-app/` - Next.js App Router example
- `nextjs-pages/` - Next.js Pages Router example
- `react-spa/` - React SPA example
- `vanilla-js/` - Vanilla JavaScript example

## Community

- [GitHub Discussions](https://github.com/vcode-sh/better-auth-telegram/discussions)
- [GitHub Issues](https://github.com/vcode-sh/better-auth-telegram/issues)
- [Better Auth Discord](https://better-auth.com/discord)

## Contributing

Contributions are welcome! Please read our [Contributing Guide](../CONTRIBUTING.md) before submitting PRs.

## License

MIT - See [LICENSE](../LICENSE)

## Author

Created by [Vibe Code](https://vcode.sh)

- Website: [vcode.sh](https://vcode.sh)
- Email: [hello@vcode.sh](mailto:hello@vcode.sh)
- GitHub: [@vcode-sh](https://github.com/vcode-sh)

## Support

- Report bugs: [GitHub Issues](https://github.com/vcode-sh/better-auth-telegram/issues)
- Get help: [Troubleshooting Guide](./troubleshooting.md)
- Email: [hello@vcode.sh](mailto:hello@vcode.sh)

---

**Need help?** Start with the [Installation Guide](./installation.md) or [Troubleshooting Guide](./troubleshooting.md).
