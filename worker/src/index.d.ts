/**
 * Types for the Worker's exported helpers.
 *
 * The Worker is plain JavaScript because it runs on Cloudflare, not through
 * this repo's TypeScript. Its merge logic is still covered by the job's test
 * run, which is typechecked, so the shapes it relies on are declared here.
 */

export function splitFeed(body: string): { events: string[][]; timezone: string[] };
export function identity(block: string[]): string;
export function fold(line: string): string;
export function escapeText(value: string): string;
export function buildMerged(ids: string[], names: string[]): Promise<string>;
