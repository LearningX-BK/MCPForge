// MCPForge — programmatic Keycloak setup for the OIDC leg of the identity
// contract suite. W0-D3, 02 §4.4 item 2.
//
// **This is test infrastructure, not gateway code.** It is not a `.test.ts` file
// so no runner collects it directly, and nothing under `core/` imports it. It
// exists so ./identity.contract.test.ts's OIDC leg can be built against a REAL
// Authorization Server — "the OIDC provider tested against a disposable Keycloak
// ... in Testcontainers" (02 §4.4 item 2) — rather than against a hand-rolled
// signer pretending to be one. A hand-rolled signer would prove that our
// verifier accepts tokens our own code produced, which is precisely the thing
// the local leg already proves and precisely not the thing this task is for.
//
// Everything below is the Keycloak Admin REST API over `fetch`. There is no
// admin-client dependency: the surface used here is five endpoints, and a
// dependency whose only job is to spell them for us is a dependency that will
// one day need a major-version migration for no benefit.
//
// **What is configured, and which contract assertion each piece serves:**
//
//   realm "mcpforge"          the issuer under test
//     client "mcpforge-agent"   direct access grants, so a test can obtain a
//                               real token; carries an AUDIENCE mapper naming
//                               the gateway's resource identifier, and a GROUP
//                               MEMBERSHIP mapper emitting `groups`
//     client "other-audience"   identical but WITHOUT the audience mapper
//                               -> the "wrong audience is refused" case
//     user "alice"              name, email, two groups -> the happy path
//     user "nameless"           no first/last name, hence no `name` claim
//                               -> the "missing required claims" case
//   realm "foreign"           a second, entirely separate issuer
//     -> the "foreign issuer is refused" case, using a token that is genuinely
//        valid, genuinely signed, and simply not ours. That is a far stronger
//        test than a garbage string, because it is the attack that actually
//        happens: a real token from a real IdP replayed at the wrong resource.

export const KEYCLOAK_IMAGE = 'quay.io/keycloak/keycloak:26.0';
export const KEYCLOAK_PORT = 8080;
export const KEYCLOAK_ADMIN_USER = 'admin';
export const KEYCLOAK_ADMIN_PASSWORD = 'admin-password-for-a-disposable-container';

export const REALM = 'mcpforge';
export const FOREIGN_REALM = 'foreign';
export const AGENT_CLIENT_ID = 'mcpforge-agent';
export const OTHER_AUDIENCE_CLIENT_ID = 'other-audience';
export const GROUPS_CLAIM = 'groups';

/** The two accounts the contract suite drives. */
export const ALICE = {
  username: 'alice.okonkwo',
  password: 'correct-horse-battery-staple',
  firstName: 'Alice',
  lastName: 'Okonkwo',
  email: 'alice.okonkwo@example.invalid',
  groups: ['ap-clerks', 'jde-users'],
} as const;

export const NAMELESS = {
  username: 'nameless',
  password: 'another-long-passphrase-entirely',
} as const;

export const FOREIGN_USER = {
  username: 'mallory',
  password: 'a-third-long-passphrase-here',
} as const;

/** Everything the contract suite needs to talk to a configured Keycloak. */
export interface KeycloakFixture {
  /** e.g. `http://localhost:32771` — always loopback, always http. */
  readonly baseUrl: string;
  readonly issuer: string;
  readonly discoveryUrl: string;
  readonly foreignIssuer: string;
  readonly foreignDiscoveryUrl: string;
  /**
   * The resource identifier this gateway is, and the `aud` the audience mapper
   * puts in tokens. A URL because RFC 8707 says a resource identifier is one.
   */
  readonly resource: string;
}

async function json(response: Response, what: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`Keycloak ${what} failed: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function expectOk(response: Response, what: string): Promise<void> {
  // Keycloak answers 201 with a Location header on create, and 409 when the
  // object already exists. 409 is tolerated so a re-run against a surviving
  // container is idempotent rather than a confusing failure.
  if (response.ok || response.status === 409) {
    return;
  }
  throw new Error(`Keycloak ${what} failed: HTTP ${response.status} ${await response.text()}`);
}

/** An admin access token from the `master` realm's `admin-cli` client. */
async function adminToken(baseUrl: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: KEYCLOAK_ADMIN_USER,
    password: KEYCLOAK_ADMIN_PASSWORD,
  });
  const response = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = (await json(response, 'admin token')) as { access_token?: unknown };
  if (typeof payload.access_token !== 'string') {
    throw new Error('Keycloak admin token response carried no access_token.');
  }
  return payload.access_token;
}

function admin(baseUrl: string, token: string) {
  return async function call(
    method: string,
    path: string,
    payload?: unknown,
  ): Promise<Response> {
    return fetch(`${baseUrl}/admin${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  };
}

function audienceMapper(resource: string): Record<string, unknown> {
  return {
    name: 'mcpforge-audience',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-audience-mapper',
    config: {
      'included.custom.audience': resource,
      'access.token.claim': 'true',
      'id.token.claim': 'false',
    },
  };
}

function groupsMapper(): Record<string, unknown> {
  return {
    name: 'mcpforge-groups',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-group-membership-mapper',
    config: {
      'claim.name': GROUPS_CLAIM,
      // Plain group names, not `/ap-clerks` paths: the git-held group→role
      // mapping (W0-D4) is documented to use "AD group DNs (or local group
      // names)", and matching the local provider's plain names here is what
      // keeps ONE mapping file format across both providers (02 §4.4).
      'full.path': 'false',
      'access.token.claim': 'true',
      'id.token.claim': 'true',
      'userinfo.token.claim': 'true',
    },
  };
}

function amrMapper(): Record<string, unknown> {
  return {
    name: 'mcpforge-amr',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-hardcoded-claim-mapper',
    config: {
      'claim.name': 'amr',
      'claim.value': '["pwd"]',
      'jsonType.label': 'JSON',
      'access.token.claim': 'true',
      'id.token.claim': 'true',
    },
  };
}

function publicClient(clientId: string, mappers: Record<string, unknown>[]): Record<string, unknown> {
  return {
    clientId,
    enabled: true,
    protocol: 'openid-connect',
    publicClient: true,
    // Resource Owner Password Credentials. Acceptable HERE and nowhere else: it
    // is how a test obtains a genuinely Keycloak-signed token without driving a
    // browser. MCPForge itself never uses this grant — 02 §4.4 says the portal
    // uses authorization code + PKCE.
    directAccessGrantsEnabled: true,
    standardFlowEnabled: false,
    // Keycloak's client-credentials ("service account") flow is NOT named here,
    // even to switch it off. `no-service-account-fallback` flags the identifier
    // wherever it appears, and that is the right behaviour: the way to be sure
    // this repository contains no service-account path is for the string not to
    // occur. Keycloak leaves the flow disabled by default, so omitting the field
    // is both the lint-clean and the actually-correct configuration.
    protocolMappers: mappers,
  };
}

/**
 * Create both realms, both clients, the groups and the users. Idempotent.
 */
export async function configureKeycloak(baseUrl: string, resource: string): Promise<KeycloakFixture> {
  const token = await adminToken(baseUrl);
  const call = admin(baseUrl, token);

  await expectOk(await call('POST', '/realms', { realm: REALM, enabled: true }), 'create realm');
  await expectOk(
    await call('POST', '/realms', { realm: FOREIGN_REALM, enabled: true }),
    'create foreign realm',
  );

  await expectOk(
    await call(
      'POST',
      `/realms/${REALM}/clients`,
      publicClient(AGENT_CLIENT_ID, [audienceMapper(resource), groupsMapper(), amrMapper()]),
    ),
    'create agent client',
  );
  await expectOk(
    await call(
      'POST',
      `/realms/${REALM}/clients`,
      // No audience mapper: its tokens are valid, signed by the right issuer,
      // and simply not addressed to this gateway.
      publicClient(OTHER_AUDIENCE_CLIENT_ID, [groupsMapper()]),
    ),
    'create other-audience client',
  );
  await expectOk(
    await call(
      'POST',
      `/realms/${FOREIGN_REALM}/clients`,
      publicClient(AGENT_CLIENT_ID, [audienceMapper(resource), groupsMapper(), amrMapper()]),
    ),
    'create foreign client',
  );

  for (const group of ALICE.groups) {
    await expectOk(await call('POST', `/realms/${REALM}/groups`, { name: group }), 'create group');
  }

  await expectOk(
    await call('POST', `/realms/${REALM}/users`, {
      username: ALICE.username,
      enabled: true,
      emailVerified: true,
      firstName: ALICE.firstName,
      lastName: ALICE.lastName,
      email: ALICE.email,
      groups: [...ALICE.groups],
      credentials: [{ type: 'password', value: ALICE.password, temporary: false }],
    }),
    'create alice',
  );
  await expectOk(
    await call('POST', `/realms/${REALM}/users`, {
      // Deliberately no firstName/lastName and no email, so Keycloak emits no
      // `name` claim and `principalFromClaims` must refuse.
      username: NAMELESS.username,
      enabled: true,
      credentials: [{ type: 'password', value: NAMELESS.password, temporary: false }],
    }),
    'create nameless',
  );
  await expectOk(
    await call('POST', `/realms/${FOREIGN_REALM}/users`, {
      username: FOREIGN_USER.username,
      enabled: true,
      firstName: 'Mallory',
      lastName: 'Stranger',
      credentials: [{ type: 'password', value: FOREIGN_USER.password, temporary: false }],
    }),
    'create foreign user',
  );

  return {
    baseUrl,
    resource,
    issuer: `${baseUrl}/realms/${REALM}`,
    discoveryUrl: `${baseUrl}/realms/${REALM}/.well-known/openid-configuration`,
    foreignIssuer: `${baseUrl}/realms/${FOREIGN_REALM}`,
    foreignDiscoveryUrl: `${baseUrl}/realms/${FOREIGN_REALM}/.well-known/openid-configuration`,
  };
}

export interface PasswordGrantRequest {
  readonly baseUrl: string;
  readonly realm: string;
  readonly clientId: string;
  readonly username: string;
  readonly password: string;
}

/** A real, Keycloak-signed access token, via the direct access grant. */
export async function passwordGrant(request: PasswordGrantRequest): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: request.clientId,
    username: request.username,
    password: request.password,
    scope: 'openid profile email',
  });
  const response = await fetch(
    `${request.baseUrl}/realms/${request.realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
  );
  const payload = (await json(response, `password grant for ${request.username}`)) as {
    access_token?: unknown;
  };
  if (typeof payload.access_token !== 'string') {
    throw new Error('Keycloak password grant returned no access_token.');
  }
  return payload.access_token;
}
