// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes
//
// Preloaded before every test file (see bunfig.toml). The plugin reads
// ~/.config/four-git/secrets.env, so without this a developer's real Forgejo
// tokens would take part in the suite. Point XDG_CONFIG_HOME and HOME at an
// empty directory and drop any exported FORGEJO_* so every test is hermetic.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const empty = mkdtempSync(join(tmpdir(), 'git-test-xdg-'));
process.env.XDG_CONFIG_HOME = empty;
process.env.HOME = empty;
for (const key of Object.keys(process.env)) {
  if (key.startsWith('FORGEJO_')) delete process.env[key];
}
