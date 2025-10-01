# Changelog

All notable changes to the better-auth-telegram plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-10-01

### Added

- Initial release of better-auth-telegram plugin
- Telegram Login Widget integration for Better Auth
- HMAC-SHA-256 verification for authentication data
- Replay attack prevention with `auth_date` validation
- Server plugin with authentication endpoints:
  - `POST /telegram/signin` - Sign in or create user
  - `POST /telegram/link` - Link Telegram to existing account
  - `POST /telegram/unlink` - Remove Telegram connection
  - `GET /telegram/config` - Get bot configuration
- Client plugin with widget initialization and methods:
  - `signInWithTelegram()` - Sign in with Telegram
  - `linkTelegram()` - Link account
  - `unlinkTelegram()` - Unlink account
  - `getTelegramConfig()` - Get bot info
  - `initTelegramWidget()` - Initialize with callback
  - `initTelegramWidgetRedirect()` - Initialize with redirect
- Database schema extensions:
  - `telegramId` field for User and Account tables
  - `telegramUsername` field for User and Account tables
- Full TypeScript support with type definitions
- Customizable widget options (size, photo, corner radius, language)
- Custom user data mapping function
- Configurable security settings (max auth age, auto-create user, allow linking)
- Framework-agnostic implementation
- Works with all Better Auth database adapters (Prisma, Kysely, Drizzle)

### Documentation

- Comprehensive README with quick start guide
- Complete installation guide with step-by-step instructions
- Usage guide with examples for React, Next.js, and vanilla JavaScript
- Full API reference documentation
- Configuration guide covering all options
- Security best practices guide
- Troubleshooting guide for common issues
- Documentation index at `docs/README.md`

### Examples

- Next.js App Router example configuration
- Next.js Pages Router example configuration

### Security

- HMAC-SHA-256 signature verification
- Timestamp validation to prevent replay attacks (default 24 hour window)
- Bot token never exposed to client
- Secure session management via Better Auth
- HTTPS requirement (enforced by Telegram)

### Configuration Options

#### Server Plugin

- `botToken` (required) - Bot token from @BotFather
- `botUsername` (required) - Bot username without @
- `allowUserToLink` (optional) - Allow linking Telegram to existing accounts (default: true)
- `autoCreateUser` (optional) - Auto-create users on first sign-in (default: true)
- `maxAuthAge` (optional) - Maximum age of authentication data in seconds (default: 86400)
- `mapTelegramDataToUser` (optional) - Custom function to map Telegram data to user object

#### Client Widget

- `size` - Button size: "large", "medium", or "small"
- `showUserPhoto` - Show user's profile photo
- `cornerRadius` - Border radius in pixels (0-20)
- `requestAccess` - Request write access permission
- `lang` - Language code (e.g., "en", "pl", "ru")

### Package Metadata

- Author: Vibe Code <hello@vcode.sh>
- Repository: https://github.com/vcode-sh/better-auth-telegram
- License: MIT
- Keywords: better-auth, telegram, authentication, plugin, typescript

[0.1.0]: https://github.com/vcode-sh/better-auth-telegram/releases/tag/v0.1.0
