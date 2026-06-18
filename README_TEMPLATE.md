# @four-bytes/four-opencode-{PLUGIN}

> {ONE_LINE_TAGLINE} — clear value proposition in one sentence.

[![npm](https://img.shields.io/npm/v/@four-bytes/four-opencode-{PLUGIN})](https://www.npmjs.com/package/@four-bytes/four-opencode-{PLUGIN})
[![license](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![bun](https://img.shields.io/badge/runtime-bun-orange)](https://bun.sh)

## Why?

{2-3 sentences explaining the problem this plugin solves and who it's for. Be specific: "For opencode users who..."}

## Quickstart

```bash
# Install globally (server + TUI)
opencode plugin @four-bytes/four-opencode-{PLUGIN} -g
```

Or manually in `~/.config/opencode/opencode.json`:
```json
{
  "plugin": ["file:///home/user/four-opencode-{PLUGIN}/dist/four-opencode-{PLUGIN}.js"]
}
```

**If the plugin has a TUI sidebar:** also register in `~/.config/opencode/tui.json`:
```json
{
  "plugin": [["/home/user/four-opencode-{PLUGIN}", { "enabled": true, "sidebar": true }]]
}
```

Restart opencode after adding. For npm-distributed plugins, `opencode plugin <name> -g` handles both files automatically.

## Configuration

Sample `.opencode/{plugin}.json`:

```json
{
  "enabled": true
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |

## Tools

| Tool | Token Savings | Description |
|------|:---:|---|
| `tool_name` | ~XX% | What it does |

### `tool_name`

**Use when:** {When should an agent use this tool?}

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `param` | string | — | ... |

## Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup.

```bash
bun install
bun run build
bun test
```

**Requirements:** Bun >= 1.0, opencode with plugin support.

## License

Apache-2.0 — see [LICENSE](LICENSE)

---

> If this plugin saves you tokens or time, consider leaving a ⭐ on [GitHub](https://github.com/four-bytes/four-opencode-{PLUGIN}).
