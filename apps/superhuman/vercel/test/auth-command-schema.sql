-- Explicit isolated test schema only. No production initializer exists.
CREATE TABLE app_command_authorizations(
 namespace TEXT NOT NULL,id TEXT NOT NULL,request_fingerprint TEXT NOT NULL,
 authorization_json TEXT NOT NULL,key_version INTEGER NOT NULL,mac BLOB NOT NULL,
 PRIMARY KEY(namespace,id),FOREIGN KEY(namespace,id) REFERENCES runtime_commands(namespace,id)
);
