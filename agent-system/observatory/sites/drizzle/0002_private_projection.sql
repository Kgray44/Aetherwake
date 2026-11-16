CREATE TABLE private_projection (
 owner_id TEXT NOT NULL,
 namespace TEXT NOT NULL,
 generated_at TEXT NOT NULL,
 payload TEXT NOT NULL,
 PRIMARY KEY (owner_id, namespace)
);
