# redmine

## Purpose
Defines the disposable Redmine service used by the local live synchronization test environment. The service is managed by the scripts in `scripts/` and seeded through the Redmine test environment runner.

## File Index
- `compose.yml`: Defines the test service, host port, health check, and separate SQLite and attachment volumes.

## Local Rules & Conventions
- Keep the service name and `REDMINE_PORT` aligned with `../../scripts/redmine-test-env.cjs`, which starts and seeds Redmine.
- Preserve the HTTP health probe and loopback port binding used by the live runner.
- Keep database and attachment storage in their named volumes so the test environment can reuse them between runs.
