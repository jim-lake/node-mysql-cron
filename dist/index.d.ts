export { config, setWorker, isStopped, start, stop };
interface Config {
  pool: any | null;
  jobTable: string;
  pollInterval: number;
  workerId: string;
  parallelLimit: number;
  errorLog?: (...args: any[]) => void;
}
interface Job {
  job_name: string;
  run_count: number;
  frequency_secs: number;
  status: string;
}
type WorkerFunction = (
  job: Job,
  done: (err?: any, result?: any) => void
) => void;
declare function config(args: Partial<Config>): void;
declare function isStopped(): boolean;
declare function setWorker(
  job_name: string,
  worker_function: WorkerFunction
): void;
declare function start(): void;
declare function stop(): void;
