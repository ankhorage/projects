import type {
  ExistingAppManifestReadResult,
  ExistingAppManifestSaveResult,
  SaveExistingAppManifestInput,
} from '../../../types/existingAppManifests.js';
import type { ExistingAppManifestRepository } from '../ports/ExistingAppManifestRepository.js';

/*** Expose manifest-only operations for caller-owned existing application directories. */
export const existingAppManifests = {
  list: async (repository: ExistingAppManifestRepository) => repository.listAsync(),
  read: async (
    repository: ExistingAppManifestRepository,
    id: string,
  ): Promise<ExistingAppManifestReadResult> => repository.readAsync(id),
  save: async (
    repository: ExistingAppManifestRepository,
    input: SaveExistingAppManifestInput,
  ): Promise<ExistingAppManifestSaveResult> => repository.saveAsync(input),
};
