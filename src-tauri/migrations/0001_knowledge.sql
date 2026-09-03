CREATE TABLE books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE editions (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    file_hash TEXT NOT NULL UNIQUE,
    format TEXT NOT NULL,
    original_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE evidence (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'external')),
    book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
    edition_id TEXT REFERENCES editions(id) ON DELETE SET NULL,
    chapter_id TEXT,
    locator_json TEXT NOT NULL DEFAULT '{}',
    text_snapshot TEXT,
    asset_hash TEXT,
    source_url TEXT,
    created_at INTEGER NOT NULL,
    CHECK (text_snapshot IS NOT NULL OR asset_hash IS NOT NULL OR source_url IS NOT NULL)
);

CREATE TABLE knowledge_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('thought', 'question', 'answer', 'concept', 'conclusion', 'summary')),
    book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
    chapter_id TEXT,
    title TEXT,
    body_md TEXT NOT NULL,
    creator TEXT NOT NULL CHECK (creator IN ('user', 'ai')),
    basis TEXT NOT NULL CHECK (basis IN ('user_thought', 'book', 'external', 'mixed')),
    review_state TEXT NOT NULL CHECK (review_state IN ('draft', 'confirmed', 'rejected')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE item_evidence (
    item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('quotes', 'basis', 'context')),
    PRIMARY KEY (item_id, evidence_id, role)
);

CREATE TABLE knowledge_edges (
    id TEXT PRIMARY KEY,
    from_item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    to_item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    relation TEXT NOT NULL CHECK (relation IN ('quotes', 'asks_about', 'derived_from', 'summarizes', 'supports', 'contradicts', 'related_to', 'mentioned_in')),
    creator TEXT NOT NULL CHECK (creator IN ('user', 'ai')),
    review_state TEXT NOT NULL CHECK (review_state IN ('draft', 'confirmed', 'rejected')),
    confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    created_at INTEGER NOT NULL,
    UNIQUE (from_item_id, to_item_id, relation),
    CHECK (from_item_id <> to_item_id)
);

CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL CHECK (mode IN ('thought', 'record')),
    book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
    chapter_id TEXT,
    locator_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX evidence_book_idx ON evidence(book_id);
CREATE INDEX knowledge_items_book_idx ON knowledge_items(book_id, review_state);
CREATE INDEX knowledge_edges_from_idx ON knowledge_edges(from_item_id, review_state);
CREATE INDEX knowledge_edges_to_idx ON knowledge_edges(to_item_id, review_state);
CREATE INDEX messages_thread_idx ON messages(thread_id, created_at);

CREATE VIRTUAL TABLE knowledge_items_fts USING fts5(
    title,
    body_md,
    content='knowledge_items',
    content_rowid='rowid'
);

CREATE TRIGGER knowledge_items_fts_insert AFTER INSERT ON knowledge_items BEGIN
    INSERT INTO knowledge_items_fts(rowid, title, body_md)
    VALUES (new.rowid, new.title, new.body_md);
END;

CREATE TRIGGER knowledge_items_fts_delete AFTER DELETE ON knowledge_items BEGIN
    INSERT INTO knowledge_items_fts(knowledge_items_fts, rowid, title, body_md)
    VALUES ('delete', old.rowid, old.title, old.body_md);
END;

CREATE TRIGGER knowledge_items_fts_update AFTER UPDATE ON knowledge_items BEGIN
    INSERT INTO knowledge_items_fts(knowledge_items_fts, rowid, title, body_md)
    VALUES ('delete', old.rowid, old.title, old.body_md);
    INSERT INTO knowledge_items_fts(rowid, title, body_md)
    VALUES (new.rowid, new.title, new.body_md);
END;
