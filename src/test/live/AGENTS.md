# live

## Purpose
Contains Extension Host scenarios that exercise synchronization against a real Redmine instance, plus the harness that isolates and observes those scenarios. These suites run only through the dedicated live-test workflow.

## File Index
- `activateHost.ts`: Activates the test extension before live scenarios.
- `dashboardHarness.ts`: Drives the real Dashboard Webview and captures UI outcomes.
- `durabilitySync.test.ts`: Checks synchronization durability across restart boundaries.
- `conflictsSync.test.ts`: Exercises remote conflict behavior.
- `dashboardSync.test.ts`: Covers synchronization behavior through the Dashboard.
- `dashboardWorkflow.test.ts`: Exercises Dashboard workflows against Redmine.
- `editorWorkflowSync.test.ts`: Covers editor-driven synchronization workflows.
- `entrypointsSync.test.ts`: Checks supported synchronization entry points.
- `faultProxy.ts`: Proxies Redmine requests and injects controlled transport faults.
- `hostContext.ts`: Passes the live ExtensionContext to the test harness.
- `isolationSync.test.ts`: Checks live synchronization isolation.
- `liveFixture.ts`: Creates isolated Redmine project, scope, proxy, and sync fixture per scenario.
- `normalSync.test.ts`: Covers normal synchronization outcomes.
- `recoverySync.test.ts`: Exercises recovery after interrupted or uncertain writes.
- `restartSync.test.ts`: Covers synchronization across Extension Host restarts.

## Local Rules & Conventions
- Register scenarios through the live fixture and run them only under the dedicated live runner; do not make ordinary test execution depend on Redmine.
- Keep each scenario isolated to its test project and scope, and clean up remote and local state in fixture teardown.
- Use the proxy traces and explicit read-back assertions to distinguish remote writes, reconciliation, and local finalization.
