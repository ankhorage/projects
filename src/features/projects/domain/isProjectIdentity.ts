/*** Recognize the canonical path-safe identity used for a project directory. */
export function isProjectIdentity(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
