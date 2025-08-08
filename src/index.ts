import { hostname, networkInterfaces } from 'node:os';
import { setTimeout } from 'node:timers/promises';

import type { NetworkInterfaceInfo } from 'node:os';
import type { MysqlError, OkPacket, Pool } from 'mysql';

const MAX_JOB_HISTORY = 100;

export default {
  config,
  isStopped,
  setWorker,
  start,
  stop,
  getLastPollStart,
  getJobHistoryList,
};
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
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };
export type WorkerFunction = (job: Job) => Promise<JSONValue>;

type MysqlValue = string | number | bigint | Date | null | undefined;
type Row = Record<string, MysqlValue>;
type QueryValues = (Record<string, MysqlValue> | MysqlValue)[];
type QueryResult<T> =
  | { err: null; results: T }
  | { err: MysqlError; results?: T };

interface InternalConfig {
  pool: Pool | null;
  jobTable: string;
  pollInterval: number;
  workerId: string;
  parallelLimit: number;
}
const g_config: InternalConfig = {
  pool: null,
  jobTable: 'nmc_job',
  pollInterval: 60 * 1000,
  workerId: _getDefaultWorkerId(),
  parallelLimit: 2,
};
const g_workerMap = new Map<string, WorkerFunction>();

let errorLog: (...args: unknown[]) => void = _defaultErrorLog;
let g_isStopped = true;
let g_lastPollStart = 0;
const g_jobHistoryList: JobHistory[] = [];

export function config(params: ConfigParams): void {
  const { errorLog: _, ...other } = params;
  Object.assign(g_config, other);
  if (params.errorLog) {
    errorLog = params.errorLog;
  }
}
export function isStopped(): boolean {
  return g_isStopped;
}
export function getLastPollStart(): number {
  return g_lastPollStart;
}
export function getJobHistoryList(): JobHistory[] {
  return g_jobHistoryList;
}
export function setWorker(
  job_name: string,
  worker_function: WorkerFunction
): void {
  g_workerMap.set(job_name, worker_function);
}
export function start(): void {
  g_isStopped = false;
  void _run();
}
export function stop(): void {
  g_isStopped = true;
}
async function _run() {
  while (!g_isStopped) {
    let jobs_ran = false;
    try {
      jobs_ran = await _poll();
    } catch (e) {
      errorLog('NMC._poll threw:', e);
    }
    if (!jobs_ran) {
      await setTimeout(g_config.pollInterval);
    }
  }
}
async function _poll(): Promise<boolean> {
  g_lastPollStart = Date.now();

  await _unstallJobs();
  const job_list = await _findJobs();

  if (job_list.length > 0) {
    const promises = job_list.map(async (job) => _runJob(job));
    await Promise.all(promises);
  }
  return job_list.length > 0;
}
async function _unstallJobs(): Promise<void> {
  const sql = `
UPDATE ${g_config.jobTable}
SET status = 'ERROR', last_result_time = NOW()
WHERE
  status = 'RUNNING'
  AND last_start_time + INTERVAL max_run_secs SECOND < NOW()
`;
  const { err, results } = await _query<OkPacket>(sql, []);
  if (err) {
    errorLog('NMC._unstallJobs: sql err:', err);
    throw err;
  } else if (results.affectedRows > 0) {
    errorLog('NMC._unstallJobs: unstalled jobs:', results.affectedRows);
  }
}
async function _findJobs(): Promise<Job[]> {
  const sql = `
SELECT *
FROM ${g_config.jobTable}
WHERE
  status != 'RUNNING'
  AND is_disabled = 0
  AND (
    last_start_time IS NULL
    OR last_interval_time IS NULL
    OR last_result_time IS NULL
    OR (
      status = 'WAITING'
      AND last_interval_time + INTERVAL frequency_secs SECOND < NOW()
    )
    OR (
      status = 'ERROR'
      AND last_result_time + INTERVAL retry_secs SECOND < NOW()
    )
  )
ORDER BY last_start_time ASC
`;
  const { err, results } = await _query<Job[]>(sql, []);
  if (err) {
    errorLog('NMC._findJob: sql err:', err);
    throw err;
  }

  const job_list = results
    .filter((job) => g_workerMap.has(job.job_name))
    .slice(0, g_config.parallelLimit);

  return job_list;
}
async function _runJob(job: Job): Promise<void> {
  const { job_name } = job;
  const job_history: JobHistory = { job_name, start_time: Date.now() };
  g_jobHistoryList.unshift(job_history);
  g_jobHistoryList.splice(MAX_JOB_HISTORY);

  let next_status: string;
  let last_result: string;

  try {
    await _startJob(job);

    try {
      const worker_function = g_workerMap.get(job_name);
      if (worker_function) {
        const result = await worker_function(job);
        last_result = _jsonStringify(result);
        next_status = 'WAITING';
      } else {
        throw new Error('no_worker');
      }
    } catch (err) {
      errorLog('NMC._runJob:', job_name, 'work error:', err);
      last_result = _errorStringify(err);
      next_status = 'ERROR';
    }

    job_history.result_status = next_status;
    job_history.result = last_result;
    const opts = { job, next_status, last_result };
    await _endJob(opts);
  } catch (err) {
    job_history.err = err;
    throw err;
  } finally {
    job_history.end_time = Date.now();
  }
}
async function _startJob(job: Job): Promise<void> {
  const { job_name, run_count } = job;
  const sql = `
UPDATE ${g_config.jobTable}
SET ?, last_start_time = NOW()
WHERE job_name = ? AND status != 'RUNNING' AND run_count = ?
`;
  const updates = {
    status: 'RUNNING',
    run_count: run_count + 1,
    last_start_worker_id: g_config.workerId,
  };
  const values = [updates, job_name, run_count];
  const { err, results } = await _query<OkPacket>(sql, values);
  if (err) {
    errorLog('NMC._startJob:', job_name, ' sql err:', err);
    throw err;
  } else if (results.affectedRows === 0) {
    throw new Error('conflict');
  }
}
async function _endJob(params: {
  job: Job;
  next_status: string;
  last_result: string;
}): Promise<void> {
  const { job, next_status, last_result } = params;
  const { job_name, frequency_secs, interval_offset_secs } = job;

  const updates: {
    status: string;
    last_result: string;
    last_interval_time?: Date;
  } = { status: next_status, last_result };

  let success_sql = '';
  if (next_status === 'WAITING') {
    success_sql = ', last_success_time = NOW()';
    const now = Date.now();
    const freq_ms = frequency_secs * 1000;
    const offset = interval_offset_secs * 1000;
    const interval_ms = Math.floor(now / freq_ms) * freq_ms + offset;
    updates.last_interval_time = new Date(interval_ms);
  }

  const sql = `
UPDATE ${g_config.jobTable}
SET ?, last_result_time = NOW() ${success_sql}
WHERE job_name = ?
`;
  const values = [updates, job_name];
  const { err } = await _query(sql, values);
  if (err) {
    errorLog('NMC._endJob:', job_name, 'sql err:', err);
    throw err;
  }
}
function _getDefaultWorkerId(): string {
  const host = hostname();
  const addresses: NetworkInterfaceInfo[] = [];
  for (const interfaceList of Object.values(networkInterfaces())) {
    if (interfaceList) {
      for (const addr of interfaceList) {
        addresses.push(addr);
      }
    }
  }
  const first_addr = addresses.find(
    (addr) => !addr.internal && !_isLocalAddress(addr.address)
  );
  let ret = host;
  if (first_addr) {
    ret += `;${first_addr.address}`;
  }
  ret += `;${process.pid}`;
  return ret;
}
function _isLocalAddress(address: string): boolean {
  return address.startsWith('fe80') || address.startsWith('169.254');
}
function _defaultErrorLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.error(...args);
}
function _errorStringify(err: unknown): string {
  let ret = '';
  if (err instanceof Error) {
    const stack = err.stack ?? '';
    const errorObj = _jsonStringify({ ...err });
    ret = `${stack} ${errorObj}`;
  } else if (typeof err === 'object' && err !== null) {
    ret = _jsonStringify(err);
  } else {
    ret = String(err);
  }
  return ret;
}
function _jsonStringify(obj: unknown): string {
  let ret = '';
  try {
    ret = JSON.stringify(obj);
  } catch {
    ret = String(obj);
  }
  return ret;
}
async function _query<T = Row[]>(
  sql: string,
  values: QueryValues
): Promise<QueryResult<T>> {
  return new Promise((resolve, reject) => {
    if (g_config.pool) {
      g_config.pool.query(sql, values, (err, results) => {
        resolve({ err, results: results as T });
      });
    } else {
      reject(new Error('no_pool'));
    }
  });
}
