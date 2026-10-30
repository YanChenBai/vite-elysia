// @env node
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { BaseEnvRunner } from 'env-runner';

import type { ElysiaRuntime, WorkerData } from './types.ts';

/**
 * Use native PATH lookup: POSIX `which` can return MSYS paths on Windows.
 */
export class RuntimeProcessRunner extends BaseEnvRunner {
  /**
   * The process currently owning the application's listener and IPC channel.
   */
  private child: ChildProcess | undefined;

  /**
   * Resolves on process exit so reloads cannot leave a previous child running.
   */
  private exited: Promise<void> = Promise.resolve();

  constructor(workerEntry: string, data: WorkerData, runtime: ElysiaRuntime | undefined) {
    super({ name: 'vite-elysia', workerEntry, data: { ...data } });

    this._initWithVirtualData(() => {
      const command = (runtime ?? 'bun') + (process.platform === 'win32' ? '.exe' : '');

      // Runtime-manager shims may spawn another process without forwarding IPC.
      const executable = execFileSync(command, ['-p', 'process.execPath'], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();

      const child = spawn(executable, [workerEntry], {
        env: this._processEnv(),
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });

      this.child = child;

      const exit = Promise.withResolvers<void>();
      this.exited = exit.promise;

      child.once('exit', code => {
        exit.resolve();
        void this.close(new Error(`${runtime ?? 'bun'} child process exited with code ${code}`));
      });

      child.once('error', error => {
        exit.resolve();
        void this.close(error);
      });

      child.on('message', message => this._handleProcessMessage(message));
      child.stdout?.pipe(process.stdout);
      child.stderr?.pipe(process.stderr);
    });
  }

  sendMessage(message: unknown): void {
    if (!this.child?.connected) {
      throw new Error('Runtime child process IPC is unavailable');
    }

    this.child.send(message as object);
  }

  protected _hasRuntime(): boolean {
    return this.child !== undefined;
  }

  protected _runtimeType(): string {
    return 'process';
  }

  /**
   * Forced termination is the fallback after the manager's graceful shutdown deadline.
   */
  protected async _closeRuntime(): Promise<void> {
    const child = this.child;
    this.child = undefined;

    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }

    await this.exited;
  }
}
