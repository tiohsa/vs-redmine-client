#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const composeFile = path.join(repoRoot, "docker", "redmine", "compose.yml");
const serviceName = "redmine";

const SEED_RUBY = `
require "json"

if Redmine::DefaultData::Loader.no_data?
  Redmine::DefaultData::Loader.load("en")
end

Setting.rest_api_enabled = 1

admin = User.find_by(login: "admin")
unless admin
  admin = User.new(
    login: "admin",
    firstname: "Redmine",
    lastname: "Admin",
    mail: "admin@example.net",
    language: "en",
    admin: true,
    status: User::STATUS_ACTIVE
  )
  admin.password = "admin1234"
  admin.password_confirmation = "admin1234"
  admin.must_change_passwd = false
  admin.save!
else
  admin.update!(admin: true, status: User::STATUS_ACTIVE, must_change_passwd: false)
end

api_key = admin.api_key

project = Project.find_by(identifier: "e2e-seed")
unless project
  project = Project.new(
    name: "E2E Seed Project",
    identifier: "e2e-seed",
    is_public: false,
    enabled_module_names: ["issue_tracking", "time_tracking"],
    tracker_ids: Tracker.pluck(:id)
  )
  project.save!
end

tracker = project.trackers.first || Tracker.first
status = IssueStatus.where(is_closed: false).first || IssueStatus.first
priority = IssuePriority.find_by(is_default: true) || IssuePriority.first

issue = Issue.find_by(project_id: project.id, subject: "E2E Seed Issue")
unless issue
  issue = Issue.create!(
    project: project,
    tracker: tracker,
    status: status,
    priority: priority,
    author: admin,
    subject: "E2E Seed Issue",
    description: "Seed issue created by redmine-test-env.cjs"
  )
end

issue.reload
if issue.journals.empty?
  issue.init_journal(admin, "Initial seed comment")
  issue.save!
end

puts "REDMINE_SEED_API_KEY=" + api_key
`.trim();

function runCompose(args, options = {}) {
  const result = spawnSync("docker", ["compose", "-f", composeFile, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = options.capture ? (result.stderr || result.stdout || "").trim() : "";
    throw new Error(`docker compose ${args.join(" ")} failed (exit ${result.status})${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getContainerId() {
  const result = runCompose(["ps", "-q", serviceName], { capture: true });
  return result.stdout.trim();
}

async function waitForHealthy(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const containerId = getContainerId();
    if (containerId) {
      const inspect = spawnSync(
        "docker",
        ["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", containerId],
        { encoding: "utf8" }
      );
      if (inspect.status === 0) {
        const status = inspect.stdout.trim();
        if (status === "healthy") {
          return;
        }
        if (status === "exited" || status === "dead") {
          throw new Error(`Redmine container entered ${status} state`);
        }
      }
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for Redmine container to become healthy (${timeoutMs}ms)`);
}

async function up() {
  process.stderr.write("[redmine-test-env] Starting Redmine container...\n");
  runCompose(["up", "-d"]);
  process.stderr.write("[redmine-test-env] Waiting for Redmine to become healthy...\n");
  await waitForHealthy();
  process.stderr.write("[redmine-test-env] Redmine is healthy.\n");
}

function seed() {
  process.stderr.write("[redmine-test-env] Seeding Redmine database...\n");
  const result = runCompose(
    ["exec", "-T", serviceName, "bundle", "exec", "rails", "runner", "-e", "production", SEED_RUBY],
    { capture: true }
  );
  const match = result.stdout.match(/^REDMINE_SEED_API_KEY=([a-f0-9]+)$/m);
  if (!match) {
    throw new Error(`Failed to extract API key from rails runner output:\n${result.stdout}\n${result.stderr}`);
  }
  return match[1];
}

function hasCommand(cmd) {
  const result = spawnSync("which", [cmd], { stdio: "ignore" });
  return result.status === 0;
}

async function runTests() {
  await up();
  const apiKey = seed();
  const port = process.env.REDMINE_PORT || "3000";
  const env = {
    ...process.env,
    REDMINE_SYNC_LIVE_URL: `http://127.0.0.1:${port}/`,
    REDMINE_API_KEY: apiKey,
  };

  const useXvfb = hasCommand("xvfb-run");
  const cmd = useXvfb ? "xvfb-run" : "pnpm";
  const args = useXvfb ? ["-a", "pnpm", "run", "test:live-redmine"] : ["run", "test:live-redmine"];

  process.stderr.write(`[redmine-test-env] Running ${cmd} ${args.join(" ")} against ${env.REDMINE_SYNC_LIVE_URL}\n`);
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
  }
}

function down() {
  process.stderr.write("[redmine-test-env] Stopping and removing Redmine containers and volumes...\n");
  runCompose(["down", "-v", "--remove-orphans"]);
}

async function main() {
  const command = process.argv[2];
  switch (command) {
    case "up":
      await up();
      break;
    case "seed": {
      const apiKey = seed();
      process.stdout.write(`${apiKey}\n`);
      break;
    }
    case "test":
      await runTests();
      break;
    case "down":
      down();
      break;
    default:
      process.stderr.write("Usage: node scripts/redmine-test-env.cjs <up|seed|test|down>\n");
      process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { up, seed, runTests, down };
