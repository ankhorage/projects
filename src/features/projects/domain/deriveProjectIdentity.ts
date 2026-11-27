import { slugifyAscii } from '@ankhorage/utility/string';

import { isProjectIdentity } from './isProjectIdentity.js';

/*** Derive the canonical path-safe project identity from a project name. */
export function deriveProjectIdentity(name: string): string {
  const id = slugifyAscii(name);
  if (!isProjectIdentity(id)) {
    throw new Error('A project name must derive a lowercase hyphenated identity.');
  }
  return id;
}
