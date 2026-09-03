ALTER TABLE knowledge_items ADD COLUMN category TEXT;

CREATE INDEX knowledge_items_category_idx
ON knowledge_items(category, review_state);
