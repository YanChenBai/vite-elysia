/**
 * State exposed by integration fixtures to verify process replacement.
 */
export interface ServerState {
  /**
   * Application value captured when the child evaluates the fixture module.
   */
  value: string;

  /**
   * Child PID used to verify isolation, replacement, and cleanup.
   */
  pid: number;

  /**
   * Runtime actually executing the fixture, independent of the test host.
   */
  runtime: string;
}
