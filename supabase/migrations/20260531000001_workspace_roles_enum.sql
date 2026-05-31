-- Enum values must commit before use in functions/policies (PostgreSQL 55P04).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'app_admin';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ic_lead_hcs';
