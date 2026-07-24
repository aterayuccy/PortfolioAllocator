DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ourusers'
          AND column_name = 'email'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ourusers'
          AND column_name = 'username'
    ) THEN
        ALTER TABLE ourusers RENAME COLUMN email TO username;
    END IF;
END
$migration$^^^
