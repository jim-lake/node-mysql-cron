declare const _default: {
  config: typeof config;
  isStopped: typeof isStopped;
  setWorker: typeof setWorker;
  start: typeof start;
  stop: typeof stop;
  getLastPollStart: typeof getLastPollStart;
  getJobHistoryList: typeof getJobHistoryList;
};
export default _default;
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
  interval_offset_secs: number;
  last_success_time: Date;
  last_result: string;
  status: string;
}
type JobHistory = {
  job_name: string;
  start_time: number;
  end_time?: number;
  err?: any;
  result_status?: any;
  result?: any;
};
type WorkerFunction = (
  job: Job,
  done: (err?: any, result?: any) => void
) => void;
export declare function config(args: Partial<Config>): void;
export declare function isStopped(): boolean;
export declare function getLastPollStart(): number;
export declare function getJobHistoryList(): JobHistory[];
export declare function setWorker(
  job_name: string,
  worker_function: WorkerFunction
): void;
export declare function start(): void;
export declare function stop(): void;
