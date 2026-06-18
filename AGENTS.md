# {{ PLUGIN_NAME }} — AGENTS.md

Pointer to central standards: `~/.personal-config/ai-shared/AGENTS.md` and meta-repo `four-bytes/opencode-plugins` AGENTS.md.

## Convention
- Source file: `src/four-opencode-{{ PLUGIN_NAME }}.ts` (NOT `src/index.ts`)
- npm name: `@four-bytes/four-opencode-{{ PLUGIN_NAME }}`
- License: Apache-2.0
- ESM, Bun-targeted, strict TypeScript

## Build Discipline (MANDATORY)
- EVERY code change ends with: version bump in `package.json` + `bun run build`
- No merge without current `dist/`
- `dist/` is gitignored, freshly built on `npm publish`

## Standards
`~/.personal-config/ai-shared/AGENTS.md`

## This Plugin
- Plugin name: PLUGIN_NAME
- Description: PLUGIN_DESCRIPTION
- Status: Sprint X

## Workflow
Issues → Branch → PR → Merge (feature workflow)
