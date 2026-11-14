import { slugifyAscii } from '@ankhorage/utility/string';

/*** Derive the canonical path-safe project identity from a project name. */
export function deriveProjectIdentity(name: string): string {
  const id = slugifyAscii(name);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error('A project name must derive a lowercase hyphenated identity.');
  }
  return id;
}
