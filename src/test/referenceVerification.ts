import { deepStrictEqual, ok } from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import * as vscode from "vscode";

interface Scenario {
  id: string;
  command: string;
  expectedResult: string;
  maxLatencyMs: number;
  maxCpuMs: number;
  maxRssBytes: number;
}

export async function run(): Promise<void> {
  const mapFile = process.env.REDMINE_VERIFICATION_MAP;
  const reportFile = process.env.REDMINE_VERIFICATION_REPORT;
  ok(mapFile && reportFile);
  const { scenarios }: { scenarios: Scenario[] } = JSON.parse(readFileSync(mapFile, "utf8"));
  const trace: object[] = [];
  for (const scenario of scenarios) {
    const start = performance.now();
    const cpu = process.cpuUsage();
    try {
      const result: unknown = await vscode.commands.executeCommand(scenario.command);
      const latencyMs = performance.now() - start;
      const usage = process.cpuUsage(cpu);
      const cpuMs = (usage.user + usage.system) / 1000;
      const rssBytes = process.memoryUsage.rss();
      trace.push({ id: scenario.id, result, latencyMs, cpuMs, rssBytes });
      deepStrictEqual(result, scenario.expectedResult);
      ok(latencyMs <= scenario.maxLatencyMs, "Latency budget exceeded");
      ok(cpuMs <= scenario.maxCpuMs, "CPU budget exceeded");
      ok(rssBytes <= scenario.maxRssBytes, "RSS budget exceeded");
    } catch (error) {
      trace.push({ id: scenario.id, error: String(error) });
    }
  }
  writeFileSync(reportFile, JSON.stringify(trace, null, 2));
  ok(trace.every(event => !("error" in event)), "Verification scenario failed");
}
