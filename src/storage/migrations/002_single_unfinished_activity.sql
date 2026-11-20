-- 本機只有一組教師設定；所有教師工作階段代表同一位老師。
CREATE UNIQUE INDEX one_unfinished_activity ON activities ((1)) WHERE state <> 'CLOSED';
