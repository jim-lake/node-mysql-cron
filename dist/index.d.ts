import type { Pool } from 'mysql';
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
export interface ConfigParams {
    pool: Pool;
    jobTable?: string;
    pollInterval?: number;
    workerId?: string;
    parallelLimit?: number;
    errorLog?: (...args: readonly unknown[]) => void;
}
export interface Job {
    job_name: string;
    run_count: number;
    frequency_secs: number;
    interval_offset_secs: number;
    last_success_time: Date;
    last_result: string;
    status: string;
}
export interface JobHistory {
    job_name: string;
    start_time: number;
    end_time?: number;
    err?: unknown;
    result_status?: unknown;
    result?: unknown;
}
export type JSONValue = string | number | boolean | null | JSONValue[] | {
    [key: string]: JSONValue;
};
export type WorkerFunction = (job: Job) => Promise<JSONValue>;
export declare function config(params: ConfigParams): void;
export declare function isStopped(): boolean;
export declare function getLastPollStart(): number;
export declare function getJobHistoryList(): JobHistory[];
export declare function setWorker(job_name: string, worker_function: WorkerFunction): void;
export declare function start(): void;
export declare function stop(): void;
