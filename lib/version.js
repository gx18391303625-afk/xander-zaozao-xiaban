import { readFileSync } from 'node:fs';

// MCP, CLI and the panel must report the same version as the installed package.
export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
