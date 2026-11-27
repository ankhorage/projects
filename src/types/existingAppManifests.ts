import type { AppManifest } from '@ankhorage/contracts';

/*** A manifest read directly from its caller-owned existing application directory. */
export type ExistingAppManifestProject = Readonly<{
  id: string;
  manifest: AppManifest;
  manifestDigest: string;
}>;

/*** The observable outcome of resolving an existing application manifest. */
export type ExistingAppManifestReadResult =
  | Readonly<{ status: 'found'; project: ExistingAppManifestProject }>
  | Readonly<{ status: 'missing-project' }>
  | Readonly<{ status: 'missing-manifest' }>
  | Readonly<{ status: 'invalid-manifest'; message: string }>;

/*** Input for a fail-closed, content-versioned existing-manifest replacement. */
export type SaveExistingAppManifestInput = Readonly<{
  id: string;
  manifest: AppManifest;
  expectedManifestDigest: string;
}>;

/*** The observable outcome of replacing an existing application manifest. */
export type ExistingAppManifestSaveResult =
  | Readonly<{ status: 'saved'; project: ExistingAppManifestProject }>
  | Readonly<{ status: 'missing-project' }>
  | Readonly<{ status: 'missing-manifest' }>
  | Readonly<{ status: 'invalid-manifest'; message: string }>
  | Readonly<{ status: 'conflict'; actualManifestDigest: string }>;
