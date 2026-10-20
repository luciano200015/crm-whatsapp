-- Runs once, when the postgres volume is first initialized.
-- Separate database for integration/e2e tests so they never touch dev data.
CREATE DATABASE crm_test;
