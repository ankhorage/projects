import type {
  ExistingAppManifestProject,
  ExistingAppManifestReadResult,
  ExistingAppManifestSaveResult,
  SaveExistingAppManifestInput,
} from '../../../types/existingAppManifests.js';

/*** Persist manifests directly in caller-owned existing application roots. */
export interface ExistingAppManifestRepository {
  listAsync(): Promise<readonly ExistingAppManifestProject[]>;
  readAsync(id: string): Promise<ExistingAppManifestReadResult>;
  saveAsync(input: SaveExistingAppManifestInput): Promise<ExistingAppManifestSaveResult>;
}
