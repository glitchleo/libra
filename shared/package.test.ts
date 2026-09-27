import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('loads the deployed shared package in plain Node without TypeScript source files', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'libra-shared-package-'));
  try {
    // Match production: only package metadata and emitted files are available.
    await cp(fileURLToPath(new URL('./package.json', import.meta.url)), join(fixture, 'package.json'));
    await cp(fileURLToPath(new URL('./dist', import.meta.url)), join(fixture, 'dist'), { recursive: true });
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import '@libra/shared/search';
      import { libraryStatuses, backupMaxBytes } from '@libra/shared/library';
      import { commonDetailFields, mediaDetailFields } from '@libra/shared/manual-entry';
      assert(libraryStatuses.includes('planned'));
      assert(backupMaxBytes > 0);
      assert(commonDetailFields.length > 0);
      assert(mediaDetailFields.book.some(field => field.key === 'author'));
      console.log('Shared package loaded');
    `], {
      cwd: fixture, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    expect(output.trim()).toBe('Shared package loaded');
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 15_000);
