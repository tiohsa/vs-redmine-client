import * as vscode from "vscode";

export class MemorySecretStorage implements vscode.SecretStorage {
  readonly values = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
  readonly onDidChange = this.emitter.event;
  async keys(): Promise<string[]> { return [...this.values.keys()]; }
  async get(key: string): Promise<string | undefined> { return this.values.get(key); }
  async store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    this.emitter.fire({ key });
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
    this.emitter.fire({ key });
  }
  dispose(): void { this.emitter.dispose(); }
}
