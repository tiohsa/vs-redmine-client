import * as http from "http";
import { createHash } from "crypto";

export interface ProxyRule {
  method: string;
  path: string;
  mode: "drop_before" | "drop_after" | "status_before" | "status_after" | "delay_after";
  status?: number;
  delayMs?: number;
  skip?: number;
}
export interface ProxyTrace {
  method: string;
  path: string;
  forwarded: boolean;
  status?: number;
  bodyHash?: string;
}
export interface FaultProxy {
  origin: string;
  arm(rule: ProxyRule): void;
  hits(): ProxyTrace[];
  reset(): void;
  close(): Promise<void>;
}

/** 実通信を転送し、応答だけの喪失と送信前の拒否を区別する。秘密情報は記録しない。 */
export const createFaultProxy = async (upstream: string, port = 0): Promise<FaultProxy> => {
  const target = new URL(upstream);
  if (target.origin !== "http://127.0.0.1:3000") { throw new Error("実Redmine proxyの転送先が許可範囲外です。"); }
  let rules: ProxyRule[] = [];
  let traces: ProxyTrace[] = [];
  const server = http.createServer((request, response) => {
    const method = request.method ?? "GET";
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const trace: ProxyTrace = { method, path: pathname, forwarded: false };
    const digest = createHash("sha256");
    request.on("data", (chunk: Buffer) => digest.update(chunk));
    request.on("end", () => { trace.bodyHash = digest.digest("hex"); });
    traces.push(trace);
    const index = rules.findIndex((candidate) => candidate.method === method &&
      (candidate.path === pathname || (candidate.path.endsWith("*") && pathname.startsWith(candidate.path.slice(0, -1)))));
    let rule = index < 0 ? undefined : rules[index];
    if (rule?.skip && rule.skip > 0) { rule.skip--; rule = undefined; }
    else if (index >= 0) { rules.splice(index, 1); }
    if (rule?.mode === "drop_before") { request.resume(); request.socket.destroy(); return; }
    if (rule?.mode === "status_before") {
      request.resume();
      trace.status = rule.status ?? 500;
      response.writeHead(trace.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ errors: ["live test injected failure"] }));
      return;
    }
    trace.forwarded = true;
    const outgoing = http.request(new URL(request.url ?? "/", target), {
      method,
      headers: { ...request.headers, host: target.host },
    }, (remoteResponse) => {
      trace.status = remoteResponse.statusCode;
      const chunks: Buffer[] = [];
      remoteResponse.on("data", (chunk: Buffer) => chunks.push(chunk));
      remoteResponse.on("error", () => response.destroy());
      remoteResponse.on("end", () => {
        if (rule?.mode === "drop_after") { response.destroy(); return; }
        const send = (): void => {
          if (response.destroyed) { return; }
          if (rule?.mode === "status_after") {
            response.writeHead(rule.status ?? 502, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ errors: ["live test lost upstream response"] }));
          } else {
            response.writeHead(remoteResponse.statusCode ?? 502, remoteResponse.headers);
            response.end(Buffer.concat(chunks));
          }
        };
        if (rule?.mode === "delay_after") { setTimeout(send, rule.delayMs ?? 1000); }
        else { send(); }
      });
    });
    outgoing.on("error", () => response.destroy());
    request.on("error", () => outgoing.destroy());
    request.pipe(outgoing);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") { throw new Error("proxy portが取得できません。"); }
  return {
    origin: `http://127.0.0.1:${address.port}/`,
    arm: (rule) => { rules.push({ ...rule }); },
    hits: () => traces.map((trace) => ({ ...trace })),
    reset: () => { traces = []; rules = []; },
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
};
