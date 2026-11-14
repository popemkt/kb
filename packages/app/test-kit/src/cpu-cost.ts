/**
 * What an operation costs, as the CPU time it spends (DESIGN.md → Testing
 * doctrine, "A cost budget is CPU time"). A test that holds an operation to
 * a budget holds `cpuMs`. Wall time also counts whatever the operation waited
 * for a core, and in a run that parallelises files every other file is
 * competing for one, so wall time measures the machine's load as much as the
 * code. The CPU time is the test's own thread's, user and system: the
 * engine's collector and compiler threads run beside it and spend as much
 * again, by how the engine schedules them rather than by what the code does.
 * Work an operation hands to another thread, a worker or the file system's
 * pool, is not counted. `wallMs` is for printing; nothing is held to it.
 */
export interface CpuCost<T> {
  readonly value: T;
  readonly cpuMs: number;
  readonly wallMs: number;
}

export function cpuCost<T>(run: () => T | Promise<T>): Promise<CpuCost<T>> {
  const cpu = process.threadCpuUsage();
  const started = performance.now();
  return Promise.resolve(run()).then((value) => {
    const wallMs = performance.now() - started;
    const { user, system } = process.threadCpuUsage(cpu);
    return { value, cpuMs: (user + system) / 1000, wallMs };
  });
}
