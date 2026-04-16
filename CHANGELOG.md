# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-04-15

### Features

- **`reset-dont-ask`** — Reset "Don't Ask Again" preferences that Cursor stores outside its normal settings reset. Currently supports mode-switch dialogs (agent/plan auto-switch countdown).
- **`move-agent-chats`** — Interactive wizard to list, copy, or move agent chat history between workspaces. Supports both old and new Cursor chat storage formats.
- **Non-interactive CLI flags** — Both commands support `--no-quit`, `--no-relaunch`, and command-specific flags for fully scriptable usage without a TTY.
- **Cross-platform support** — macOS, Linux, and Windows for DB paths, process detection, quit, and relaunch.
- **Interactive TUI** — Custom terminal widgets: dropdown select, multi-select, type-to-filter, review step, with full esc-to-go-back navigation.
