CREATE TABLE selected_threads (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE
);

ALTER TABLE messages ADD COLUMN context_json TEXT
    CHECK (context_json IS NULL OR json_valid(context_json));
ALTER TABLE messages ADD COLUMN state TEXT NOT NULL DEFAULT 'complete'
    CHECK (state IN ('complete', 'interrupted', 'failed'));

CREATE INDEX threads_book_mode_updated_idx ON threads(book_id, mode, updated_at DESC);
