CREATE TABLE IF NOT EXISTS tracking_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT OR IGNORE INTO tracking_meta VALUES('schema','rea-tracking-collector-v2');
    CREATE TABLE IF NOT EXISTS tracking_registrations(
      tenant TEXT NOT NULL,id TEXT NOT NULL,account_ref TEXT NOT NULL,delivery_ref TEXT NOT NULL,
      token_digest TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('prepared','armed','confirmed','disabled')),
      revision INTEGER NOT NULL,ack_ref TEXT,confirmed_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
      PRIMARY KEY(tenant,id),UNIQUE(tenant,delivery_ref));
    CREATE INDEX IF NOT EXISTS tracking_registration_account ON tracking_registrations(tenant,account_ref);
    CREATE TABLE IF NOT EXISTS tracking_bindings(tenant TEXT NOT NULL,id TEXT NOT NULL,account_ref TEXT NOT NULL,delivery_ref TEXT NOT NULL,token_digest TEXT NOT NULL,created_at INTEGER NOT NULL,ack_ref TEXT,confirmed_at INTEGER,PRIMARY KEY(tenant,id),FOREIGN KEY(tenant,id) REFERENCES tracking_registrations(tenant,id));
    CREATE TABLE IF NOT EXISTS tracking_requests(tenant TEXT NOT NULL,operation_id TEXT NOT NULL,fingerprint TEXT NOT NULL,request_path TEXT NOT NULL,request_json TEXT NOT NULL,response_json TEXT NOT NULL,accepted_at INTEGER NOT NULL,PRIMARY KEY(tenant,operation_id));
    CREATE TABLE IF NOT EXISTS tracking_nonces(key_id TEXT NOT NULL,nonce TEXT NOT NULL,used_at INTEGER NOT NULL,PRIMARY KEY(key_id,nonce));
    CREATE TABLE IF NOT EXISTS tracking_tenant_revisions(tenant TEXT PRIMARY KEY,revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tracking_events(
      tenant TEXT NOT NULL,account_ref TEXT NOT NULL,sequence INTEGER NOT NULL,id TEXT NOT NULL UNIQUE,registration_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,device TEXT NOT NULL,proxy TEXT NOT NULL,PRIMARY KEY(tenant,account_ref,sequence),
      FOREIGN KEY(tenant,registration_id) REFERENCES tracking_registrations(tenant,id));
    CREATE INDEX IF NOT EXISTS tracking_events_rate ON tracking_events(observed_at,registration_id);
    CREATE TABLE IF NOT EXISTS tracking_throttle(tenant TEXT NOT NULL,account_ref TEXT NOT NULL,minute INTEGER NOT NULL,dropped INTEGER NOT NULL,PRIMARY KEY(tenant,account_ref,minute));
