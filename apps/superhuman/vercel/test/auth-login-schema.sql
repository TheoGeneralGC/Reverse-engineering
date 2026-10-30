-- Test fixture only. There is no production schema initializer/migration.
CREATE TABLE auth_login_browsers(browser_digest BLOB PRIMARY KEY CHECK(length(browser_digest)=32),generation INTEGER NOT NULL CHECK(generation>=1));
CREATE TABLE auth_login_attempts(
 state_digest BLOB PRIMARY KEY CHECK(length(state_digest)=32),
 browser_digest BLOB NOT NULL CHECK(length(browser_digest)=32),
 browser_generation INTEGER NOT NULL CHECK(browser_generation>=1),
 session_cookie_digest BLOB,
 session_binding_json TEXT NOT NULL CHECK(json_valid(session_binding_json)),
 purpose TEXT NOT NULL CHECK(purpose IN('login','owner-identity-proof')),
 client_id TEXT NOT NULL,
 callback_uri TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 expires_ms INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN('pending','exchanging','consumed','failed')),
 claim_id TEXT,
 sealed BLOB,
 outcome_session_id TEXT REFERENCES app_sessions(session_record_id)
);
