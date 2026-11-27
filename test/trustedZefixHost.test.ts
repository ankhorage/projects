import { composeAuthorizedApiRuntime } from '@ankhorage/api';
import type { InternalRestApiDefinition } from '@ankhorage/contracts/data';
import type { SecretStoreAdapter } from '@ankhorage/secrets/port';
import { describe, expect, test } from 'bun:test';

import { createTrustedZefixHost } from '../src/index.js';

describe('createTrustedZefixHost', () => {
  test('denies before Vault or transport access', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost({
      ...createHostInput(calls),
      authenticateCallerAsync: async () => undefined,
    });
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync(
      searchRequest(),
    );

    expect(response.status).toBe(403);
    expect(calls).toEqual({ secret: 0, fetch: 0 });
  });

  test('uses immutable scope, keeps Basic credentials server-side, and returns only company', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost(createHostInput(calls));
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync(
      searchRequest(),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ uid: 'CHE-123.456.789', name: 'Acme' }]);
    expect(calls).toEqual({ secret: 1, fetch: 1 });
  });

  test('denies a caller outside the immutable project and environment before side effects', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost({
      ...createHostInput(calls),
      authorizeCallerAsync: async () => false,
    });
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync(
      searchRequest(),
    );

    expect(response.status).toBe(403);
    expect(calls).toEqual({ secret: 0, fetch: 0 });
  });

  test('redacts Vault and transport failures without returning a result payload', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost({
      ...createHostInput(calls),
      secretStore: {
        ...createSecretStore(calls),
        resolve: async () => ({
          ok: false as const,
          error: { code: 'provider_error' as const, message: 'password=not-for-client' },
        }),
      },
    });
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync(
      searchRequest(),
    );

    expect(response).toEqual({
      status: 502,
      headers: {},
      body: { error: { code: 'zefix_unavailable' } },
    });
    expect(JSON.stringify(response)).not.toContain('password');
    expect(calls.fetch).toBe(0);
  });

  test('executes only the separately declared UID operation through its matching capability', async () => {
    const calls = { secret: 0, fetch: 0 };
    const host = createTrustedZefixHost({
      ...createHostInput(calls),
      definition: createUidDefinition(),
      operations: { 'zefix.uid': 'company.get-by-uid' },
    });
    const response = await composeAuthorizedApiRuntime(host.composition).dispatchAsync({
      operationId: 'zefix.uid',
      method: 'GET',
      params: { id: 'CHE-123.456.789' },
      query: {},
      headers: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ uid: 'CHE-123.456.789', name: 'Acme' }]);
  });
});

/*** Compose a trusted host with local fakes only; no real Vault or Zefix request is possible. */
function createHostInput(calls: { secret: number; fetch: number }) {
  return {
    appId: 'acquisition-app',
    projectId: 'project-a',
    environment: 'production',
    definition: createDefinition(),
    operations: { 'zefix.search': 'company.search' as const },
    authenticateCallerAsync: async () => ({ subject: 'user-a' }),
    authorizeCallerAsync: async (input: { projectId: string; environment: string }) =>
      input.projectId === 'project-a' && input.environment === 'production',
    secretStore: createSecretStore(calls),
    fetch: async (_url: string, init: { headers: Readonly<Record<string, string>> }) => {
      calls.fetch += 1;
      expect(init.headers.authorization).toBe(`Basic ${btoa('user:password')}`);
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        text: async () => '[{"uid":"CHE-123.456.789","name":"Acme","wire":"never-client"}]',
      };
    },
  };
}

/*** Declare exactly one internal operation and its Projects-owned host capability. */
function createDefinition(): InternalRestApiDefinition {
  return {
    id: 'acquisition-host',
    origin: 'internal',
    protocol: 'rest',
    basePath: '/internal',
    endpoints: {
      zefix: {
        id: 'zefix',
        kind: 'http',
        operations: {
          'zefix.search': { id: 'zefix.search', protocol: 'http', intent: 'read', method: 'POST' },
        },
      },
    },
    handlers: {
      'zefix.search': { operationId: 'zefix.search', capability: 'projects.zefix.search' },
    },
  };
}

/*** Declare the distinct UID lookup operation and its exact host capability. */
function createUidDefinition(): InternalRestApiDefinition {
  return {
    ...createDefinition(),
    endpoints: {
      zefix: {
        id: 'zefix',
        kind: 'http',
        operations: {
          'zefix.uid': { id: 'zefix.uid', protocol: 'http', intent: 'read', method: 'GET' },
        },
      },
    },
    handlers: {
      'zefix.uid': { operationId: 'zefix.uid', capability: 'projects.zefix.get-by-uid' },
    },
  };
}

/*** Construct one canonical internal request without client-controlled composition identities. */
function searchRequest() {
  return {
    operationId: 'zefix.search',
    method: 'POST' as const,
    params: {},
    query: {},
    headers: {},
    body: { name: 'Acme' },
  };
}

/*** Provide a fully local SecretStore adapter that records only resolve calls. */
function createSecretStore(calls: { secret: number }): SecretStoreAdapter {
  return {
    list: async () => ({ ok: true, data: [] }),
    getMetadata: async () => ({ ok: false, error: { code: 'not_found', message: 'not used' } }),
    create: async () => ({ ok: false, error: { code: 'permission_denied', message: 'not used' } }),
    replace: async () => ({ ok: false, error: { code: 'permission_denied', message: 'not used' } }),
    remove: async () => ({ ok: false, error: { code: 'permission_denied', message: 'not used' } }),
    resolve: async (input) => {
      calls.secret += 1;
      expect(input).toEqual({
        scope: { projectId: 'project-a', environment: 'production' },
        ref: 'zefix-credentials',
      });
      return { ok: true, data: { username: 'user', password: 'password' } };
    },
  };
}
