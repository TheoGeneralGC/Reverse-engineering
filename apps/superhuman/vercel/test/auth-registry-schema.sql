-- Proposed schema only. The companion checks apply it only to :memory:.
PRAGMA foreign_keys=ON;
CREATE TABLE app_users(
 user_id TEXT PRIMARY KEY,
 status TEXT NOT NULL CHECK(status IN('active','disabled')),
 auth_epoch INTEGER NOT NULL CHECK(auth_epoch>=1),
 created_ms INTEGER NOT NULL
);
CREATE TABLE external_identities(
 issuer TEXT NOT NULL CHECK(issuer='https://accounts.google.com'),
 subject TEXT COLLATE BINARY NOT NULL CHECK(length(subject) BETWEEN 1 AND 255),
 user_id TEXT NOT NULL REFERENCES app_users(user_id),
 display_email TEXT,
 verified_ms INTEGER NOT NULL,
 PRIMARY KEY(issuer,subject)
);
CREATE TABLE personal_tenants(
 tenant_id TEXT PRIMARY KEY,
 owner_user_id TEXT NOT NULL UNIQUE REFERENCES app_users(user_id),
 status TEXT NOT NULL CHECK(status IN('active','suspended')),
 authz_epoch INTEGER NOT NULL CHECK(authz_epoch>=1),
 UNIQUE(tenant_id,owner_user_id)
);
CREATE TABLE personal_memberships(
 user_id TEXT NOT NULL UNIQUE,
 tenant_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('active','revoked')),
 authz_epoch INTEGER NOT NULL CHECK(authz_epoch>=1),
 PRIMARY KEY(user_id,tenant_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES personal_tenants(tenant_id,owner_user_id)
);
CREATE TABLE tenant_storage(
 storage_ref TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL UNIQUE REFERENCES personal_tenants(tenant_id),
 primary_ref TEXT NOT NULL UNIQUE,
 secret_ref TEXT NOT NULL,
 key_ref TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation>=1),
 status TEXT NOT NULL CHECK(status IN('active','disabled')),
 UNIQUE(storage_ref,tenant_id)
);
CREATE TABLE tenant_runtimes(
 namespace TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL UNIQUE REFERENCES personal_tenants(tenant_id),
 storage_ref TEXT NOT NULL UNIQUE,
 storage_generation INTEGER NOT NULL CHECK(storage_generation>=1),
 FOREIGN KEY(storage_ref,tenant_id) REFERENCES tenant_storage(storage_ref,tenant_id)
);
CREATE TABLE mailbox_connections(
 connection_id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES personal_tenants(tenant_id),
 issuer TEXT NOT NULL CHECK(issuer='https://accounts.google.com'),
 provider_subject TEXT COLLATE BINARY,
 legacy_core_account_id TEXT NOT NULL,
 authz_generation INTEGER NOT NULL CHECK(authz_generation>=1),
 state TEXT NOT NULL CHECK(state IN('legacy-pending-identity','active','revoked')),
 CHECK(state='legacy-pending-identity' OR provider_subject IS NOT NULL),
 UNIQUE(issuer,provider_subject),
 UNIQUE(tenant_id,legacy_core_account_id),
 UNIQUE(connection_id,tenant_id)
);
CREATE TABLE connection_services(
 connection_id TEXT NOT NULL REFERENCES mailbox_connections(connection_id),
 service TEXT NOT NULL CHECK(service IN('mail','calendar')),
 authorization_generation INTEGER NOT NULL CHECK(authorization_generation>=1),
 status TEXT NOT NULL CHECK(status IN('legacy','active','revoked')),
 legacy_slot_ref TEXT NOT NULL,
 PRIMARY KEY(connection_id,service)
);
CREATE TABLE app_sessions(
 session_record_id TEXT PRIMARY KEY,
 token_digest BLOB NOT NULL UNIQUE CHECK(length(token_digest)=32),
 hash_key_version INTEGER NOT NULL CHECK(hash_key_version>=1),
 user_id TEXT NOT NULL REFERENCES app_users(user_id),
 user_auth_epoch INTEGER NOT NULL CHECK(user_auth_epoch>=1),
 generation INTEGER NOT NULL CHECK(generation>=1),
 authority_class TEXT NOT NULL CHECK(authority_class IN('interactive-product','operator-test')),
 csrf_digest BLOB NOT NULL CHECK(length(csrf_digest)=32),
 state TEXT NOT NULL CHECK(state IN('active','revoked')),
 created_ms INTEGER NOT NULL,
 last_interactive_ms INTEGER NOT NULL,
 idle_expires_ms INTEGER NOT NULL,
 absolute_expires_ms INTEGER NOT NULL,
 CHECK(created_ms<=last_interactive_ms AND last_interactive_ms<absolute_expires_ms),
 CHECK(idle_expires_ms<=absolute_expires_ms),
 UNIQUE(session_record_id,user_id)
);
CREATE TABLE auth_attempts(
 state_digest BLOB PRIMARY KEY CHECK(length(state_digest)=32),
 browser_binding_digest BLOB NOT NULL CHECK(length(browser_binding_digest)=32),
 nonce_digest BLOB NOT NULL CHECK(length(nonce_digest)=32),
 pkce_secret_ref TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN('login','owner-identity-proof','connect-mail','reconnect-mail','connect-calendar')),
 session_record_id TEXT REFERENCES app_sessions(session_record_id),
 session_generation INTEGER,
 user_id TEXT REFERENCES app_users(user_id),
 tenant_id TEXT REFERENCES personal_tenants(tenant_id),
 membership_authz_epoch INTEGER,
 selected_connection_id TEXT REFERENCES mailbox_connections(connection_id),
 expected_connection_generation INTEGER,
 fixed_callback_ref TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('pending','exchanging','consumed','cancelled','failed')),
 expires_ms INTEGER NOT NULL,
 CHECK(purpose IN('login','owner-identity-proof') OR (session_record_id IS NOT NULL AND session_generation IS NOT NULL AND user_id IS NOT NULL AND tenant_id IS NOT NULL AND membership_authz_epoch IS NOT NULL)),
 CHECK(purpose NOT IN('reconnect-mail','connect-calendar') OR (selected_connection_id IS NOT NULL AND expected_connection_generation IS NOT NULL)),
 FOREIGN KEY(session_record_id,user_id) REFERENCES app_sessions(session_record_id,user_id),
 FOREIGN KEY(user_id,tenant_id) REFERENCES personal_memberships(user_id,tenant_id),
 FOREIGN KEY(selected_connection_id,tenant_id) REFERENCES mailbox_connections(connection_id,tenant_id)
);
CREATE TABLE owner_migration_grants(
 grant_id TEXT PRIMARY KEY,
 expected_issuer TEXT NOT NULL CHECK(expected_issuer='https://accounts.google.com'),
 expected_subject TEXT COLLATE BINARY NOT NULL CHECK(length(expected_subject) BETWEEN 1 AND 255),
 target_user_id TEXT NOT NULL,
 target_tenant_id TEXT NOT NULL,
 existing_namespace TEXT NOT NULL UNIQUE,
 existing_storage_ref TEXT NOT NULL,
 manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
 state TEXT NOT NULL CHECK(state IN('authorized','consumed')),
 reviewed_by TEXT NOT NULL CHECK(reviewed_by='operator')
);
CREATE TABLE migration_receipts(
 grant_id TEXT PRIMARY KEY REFERENCES owner_migration_grants(grant_id),
 user_id TEXT NOT NULL REFERENCES app_users(user_id),
 tenant_id TEXT NOT NULL REFERENCES personal_tenants(tenant_id),
 existing_namespace TEXT NOT NULL UNIQUE,
 manifest_sha256 TEXT NOT NULL,
 applied_ms INTEGER NOT NULL
);
