import { type ApiRequest, type ComposeAuthorizedApiRuntimeOptions } from '@ankhorage/api';
import {
  type FastifyInstance,
  registerAuthorizedFastifyApiAsync,
  type RegisterFastifyApiOptions,
} from '@ankhorage/api-fastify';
import type { InternalRestApiDefinition } from '@ankhorage/contracts/data';
import {
  createZefixPublicRestApi,
  type EndpointTestFetch,
  mapZefixCompanyResult,
  type ZefixCompanyShort,
} from '@ankhorage/data-sources';
import { createRuntimeApiCapabilityExecutor } from '@ankhorage/runtime/api-capabilities';
import type { SecretStoreAdapter } from '@ankhorage/secrets/port';
import { isRecord } from '@ankhorage/utility/object';

import { CAPABILITIES } from '../../../capabilities/index.js';

type TrustedZefixOperation = 'company.search' | 'company.get-by-uid';

export type CreateTrustedZefixHostInput = Readonly<{
  appId: string;
  projectId: string;
  environment: string;
  definition: InternalRestApiDefinition;
  operations: Readonly<Record<string, TrustedZefixOperation>>;
  authenticateCallerAsync: (request: ApiRequest) => Promise<unknown>;
  authorizeCallerAsync: (
    input: Readonly<{
      caller: unknown;
      appId: string;
      projectId: string;
      environment: string;
      operationId: string;
    }>,
  ) => Promise<boolean>;
  secretStore: SecretStoreAdapter;
  fetch?: EndpointTestFetch;
}>;

export type TrustedZefixHost = Readonly<{
  composition: ComposeAuthorizedApiRuntimeOptions;
  registerFastifyAsync: (
    server: FastifyInstance,
    options?: RegisterFastifyApiOptions,
  ) => Promise<unknown>;
}>;

/*** Compose declared Zefix operations into an authenticated, project-scoped trusted host. */
export function createTrustedZefixHost(input: CreateTrustedZefixHostInput): TrustedZefixHost {
  assertHostIdentity(input);
  const executor = createRuntimeApiCapabilityExecutor({
    apis: { zefix: createZefixPublicRestApi() },
    credentialResolver: createZefixCredentialResolver(input),
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
  const composition: ComposeAuthorizedApiRuntimeOptions = {
    definition: input.definition,
    context: { appId: input.appId, projectId: input.projectId },
    authorizeAsync: async ({ binding, request }) =>
      authorizeRequestAsync(input, binding.operationId, request),
    resolveHandler: ({ binding, declaration, context }) => {
      const operation = input.operations[binding.operationId];
      const capability = resolveCapability(operation);
      const { method } = binding.operation;
      if (
        !operation ||
        declaration.capability !== capability?.id ||
        binding.operation.intent !== 'read' ||
        method === undefined ||
        !isCanonicalOperationMethod(operation, method)
      )
        return undefined;
      return {
        capability,
        approval: {
          operationId: binding.operationId,
          intent: binding.operation.intent,
          method,
          capabilityId: capability.id,
          owner: capability.owner,
          scope: context,
        },
        handler: async (request) => executeZefixOperationAsync(executor, operation, request),
      };
    },
  };
  return {
    composition,
    registerFastifyAsync: (server, options) =>
      registerAuthorizedFastifyApiAsync(server, composition, options),
  };
}

/*** Bind each exposed host declaration to the one canonical Zefix HTTP method. */
function isCanonicalOperationMethod(operation: TrustedZefixOperation, method: string): boolean {
  return (
    (operation === 'company.search' && method === 'POST') ||
    (operation === 'company.get-by-uid' && method === 'GET')
  );
}

/*** Deny before the operation handler can resolve a Vault secret or contact Zefix. */
async function authorizeRequestAsync(
  input: CreateTrustedZefixHostInput,
  operationId: string,
  request: ApiRequest,
): Promise<boolean> {
  try {
    const caller = await input.authenticateCallerAsync(request);
    return caller === undefined
      ? false
      : input.authorizeCallerAsync({
          caller,
          appId: input.appId,
          projectId: input.projectId,
          environment: input.environment,
          operationId,
        });
  } catch {
    return false;
  }
}

/*** Resolve Basic credentials only for the canonical Zefix reference and immutable server scope. */
function createZefixCredentialResolver(input: CreateTrustedZefixHostInput) {
  return async (credential: Readonly<{ id: string; kind: string }>) => {
    if (credential.id !== 'zefix-credentials' || credential.kind !== 'basic') return undefined;
    const result = await input.secretStore.resolve({
      scope: { projectId: input.projectId, environment: input.environment },
      ref: 'zefix-credentials',
    });
    const username = result.ok ? result.data.username : undefined;
    const password = result.ok ? result.data.password : undefined;
    return typeof username === 'string' && typeof password === 'string'
      ? { headers: { authorization: `Basic ${btoa(`${username}:${password}`)}` } }
      : undefined;
  };
}

/*** Execute only an approved Zefix operation and return the curated company projection. */
async function executeZefixOperationAsync(
  executor: ReturnType<typeof createRuntimeApiCapabilityExecutor>,
  operation: TrustedZefixOperation,
  request: ApiRequest,
) {
  const input = operation === 'company.search' ? request.body : { id: request.params.id };
  const values = isHostBindingRecord(input) ? input : undefined;
  const result = await executor({
    capability: `api.zefix.${operation}`,
    ...(values === undefined ? {} : { input: values }),
  });
  if (!result.ok) return zefixUnavailableResponse();
  const companies = curateZefixResult(result.data);
  return companies === undefined ? zefixUnavailableResponse() : { body: companies };
}

/*** Strip provider wire payloads before any Zefix result crosses the trusted host boundary. */
function curateZefixResult(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const mapped = value.map((candidate) => {
    const company = asZefixCompany(candidate);
    return company ? mapZefixCompanyResult(company) : undefined;
  });
  return mapped.every((result) => result !== undefined)
    ? mapped.map((result) => result.company)
    : undefined;
}

/*** Return the one credential-safe failure representation for Vault or provider failures. */
function zefixUnavailableResponse() {
  return { status: 502, body: { error: { code: 'zefix_unavailable' } } };
}

/*** Narrow unknown endpoint data to the optional-field Zefix short-company DTO. */
function asZefixCompany(value: unknown): ZefixCompanyShort | undefined {
  return isRecord(value) &&
    optionalString(value.name) &&
    optionalString(value.uid) &&
    optionalString(value.chid) &&
    optionalString(value.legalSeat)
    ? value
    : undefined;
}

/*** Accept missing or string wire fields while rejecting non-serializable provider data. */
function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

type HostBindingValue =
  string | number | boolean | null | readonly HostBindingValue[] | HostBindingRecord;

interface HostBindingRecord {
  readonly [key: string]: HostBindingValue;
}

/*** Admit only serializable operation input before passing it to Runtime's binding executor. */
function isHostBindingRecord(value: unknown): value is HostBindingRecord {
  return isRecord(value) && Object.values(value).every(isHostBindingValue);
}

/*** Recursively reject host objects and functions from untrusted request input. */
function isHostBindingValue(value: unknown): value is HostBindingValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) && value.every(isHostBindingValue)) ||
    (isRecord(value) && Object.values(value).every(isHostBindingValue))
  );
}

/*** Resolve the one Projects-owned capability permitted for each declared Zefix operation. */
function resolveCapability(operation: TrustedZefixOperation | undefined) {
  const id =
    operation === 'company.search'
      ? 'projects.zefix.search'
      : operation === 'company.get-by-uid'
        ? 'projects.zefix.get-by-uid'
        : undefined;
  return CAPABILITIES.find((candidate) => candidate.id === id);
}

/*** Reject incomplete immutable host configuration before Fastify routes are registered. */
function assertHostIdentity(input: CreateTrustedZefixHostInput) {
  if (!input.appId.trim() || !input.projectId.trim() || !input.environment.trim())
    throw new Error(
      'Trusted Zefix host requires immutable app, project, and environment identities.',
    );
}
