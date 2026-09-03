DROP TRIGGER knowledge_items_fts_insert;
DROP TRIGGER knowledge_items_fts_delete;
DROP TRIGGER knowledge_items_fts_update;
DROP TABLE knowledge_items_fts;

CREATE VIRTUAL TABLE knowledge_items_fts USING fts5(
    title,
    body_md,
    content='knowledge_items',
    content_rowid='rowid',
    tokenize='trigram'
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

INSERT INTO knowledge_items_fts(rowid, title, body_md)
SELECT rowid, title, body_md FROM knowledge_items;
