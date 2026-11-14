import type { Capability } from '@ankhorage/contracts/capability';

/*** Publish the canonical descriptors for project repository operations. */
export const CAPABILITIES = [
  {
    id: 'projects.list',
    owner: '@ankhorage/projects',
    access: ['read'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'List projects',
    description: 'List persisted project identities.',
  },
  {
    id: 'projects.read',
    owner: '@ankhorage/projects',
    access: ['read'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'Read project',
    description: 'Read one persisted project by identity.',
  },
  {
    id: 'projects.create',
    owner: '@ankhorage/projects',
    access: ['write'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'Create project',
    description: 'Create one persisted project with a canonical identity.',
  },
  {
    id: 'projects.update',
    owner: '@ankhorage/projects',
    access: ['write'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'Update project',
    description: 'Update one existing persisted project.',
  },
  {
    id: 'projects.delete',
    owner: '@ankhorage/projects',
    access: ['write'],
    binding: { kind: 'storage', bindableAs: ['target'] },
    label: 'Delete project',
    description: 'Delete one persisted project by identity.',
  },
] as const satisfies readonly Capability[];
