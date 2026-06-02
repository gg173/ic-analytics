import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8')) as {
    version: string;
  };
  return pkg.version;
}

function readGitShortSha(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** YYYYMMDD + optional git SHA — changes on every deploy/build from a new commit. */
export function createBuildId(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const datePart = `${y}${m}${d}`;
  const sha = readGitShortSha();
  return sha ? `${datePart}.${sha}` : `${datePart}.dev`;
}
