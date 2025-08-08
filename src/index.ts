import async from 'async';
import os from 'node:os';

import type { MysqlError, OkPacket } from 'mysql';

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

export interface Config {
  pool: any | null;
  jobTable: string;
  pollInterval: number;
  workerId: string;
  parallelLimit: number;
  errorLog?: (...args: any[]) => void;
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
export type JobHistory = {
  job_name: string;
  start_time: number;
  end_time?: number;
  err?: any;
  result_status?: any;
  result?: any;
};
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

const g_config: Config = {
  pool: null,
  jobTable: 'nmc_job',
  pollInterval: 60 * 1000,
  workerId: _getDefaultWorkerId(),
  parallelLimit: 2,
};
const g_workerMap: Map<string, WorkerFunction> = new Map();

let errorLog: (...args: any[]) => void = _defaultErrorLog;
let g_isStopped = true;
let g_timeout: NodeJS.Timeout | null = null;
let g_lastPollStart: number = 0;
const g_jobHistoryList: JobHistory[] = [];

export function config(args: Partial<Config>): void {
  Object.assign(g_config, args);
  if (args.errorLog) {
    errorLog = args.errorLog;
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
  _pollLater();
}
export function stop(): void {
  g_isStopped = true;
  if (g_timeout) {
    clearTimeout(g_timeout);
    g_timeout = null;
  }
}
function _pollLater(): void {
  if (!g_isStopped) {
    g_timeout = setTimeout(_poll.bind(null, _pollLater), g_config.pollInterval);
  }
}
function _poll(done: (err?: any) => void): void {
  g_lastPollStart = Date.now();
  let job_list: Job[] = [];
  async.series(
    [
      _unstallJobs,
      (done) => {
        _findJobs((err, list) => {
          job_list = list;
          done(err);
        });
      },
      (done) => {
        if (job_list.length > 0) {
          async.each(
            job_list,
            (job, done) => {
              _runJob(job, () => done());
            },
            done
          );
        } else {
          done();
        }
      },
    ],
    (err) => {
      if (!err && job_list.length > 0) {
        setImmediate(_poll.bind(null, done));
      } else {
        done(err);
      }
    }
  );
}
function _unstallJobs(done: (err?: any) => void): void {
  const sql = `
UPDATE ${g_config.jobTable}
SET status = 'ERROR', last_result_time = NOW()
WHERE
  status = 'RUNNING'
  AND last_start_time + INTERVAL max_run_secs SECOND < NOW()
`;
  g_config.pool!.query(sql, [], (err, results) => {
    if (err) {
      errorLog('NMC._unstallJobs: sql err:', err);
    } else if (results.affectedRows > 0) {
      errorLog('NMC._unstallJobs: unstalled jobs:', results.affectedRows);
    }
    done(err);
  });
}
function _findJobs(done: (err: any, list: Job[]) => void): void {
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
  g_config.pool!.query(sql, [], (err, results: Job[]) => {
    let job_list: Job[] = [];
    if (err) {
      errorLog('NMC._findJob: sql err:', err);
    } else {
      job_list = results
        .filter((job) => g_workerMap.has(job.job_name))
        .slice(0, g_config.parallelLimit);
    }
    done(err, job_list);
  });
}
async function _runJob(job: Job, done: (err?: any) => void): Promise<void> {
  const { job_name } = job;
  const job_history: JobHistory = { job_name, start_time: Date.now() };
  g_jobHistoryList.unshift(job_history);
  g_jobHistoryList.splice(MAX_JOB_HISTORY);

  let next_status: string;
  let last_result: string;
  async.series(
    [
      (done) => _startJob(job, done),
      (done) => {
        const worker_function = g_workerMap.get(job_name);
        worker_function!(job)
          .then((result) => {
            last_result = _jsonStringify(result);
            next_status = 'WAITING';
            done();
          })
          .catch((err) => {
            errorLog('NMC._runJob:', job_name, 'work error:', err);
            last_result = _errorStringify(err);
            next_status = 'ERROR';
            done();
          });
      },
      (done) => {
        job_history.result_status = next_status;
        job_history.result = last_result;
        const opts = { job, next_status, last_result };
        _endJob(opts, done);
      },
    ],
    (err) => {
      job_history.end_time = Date.now();
      job_history.err = err;
      done(err);
    }
  );
}
function _startJob(job: Job, done: (err?: any) => void): void {
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
  g_config.pool!.query(sql, values, (err, results) => {
    if (err) {
      errorLog('NMC._startJob:', job_name, ' sql err:', err);
    } else if (results.affectedRows === 0) {
      err = 'conflict';
    }
    done(err);
  });
}
function _endJob(
  params: { job: Job; next_status: string; last_result: string },
  done: (err?: any) => void
): void {
  const { job, next_status, last_result } = params;
  const { job_name, frequency_secs, interval_offset_secs } = job;

  const updates: any = { status: next_status, last_result };

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
  g_config.pool!.query(sql, values, (err) => {
    if (err) {
      errorLog('NMC._endJob:', job_name, ' sql err:', err);
    }
    done(err);
  });
}
function _getDefaultWorkerId(): string {
  const host = os.hostname();
  const addresses: os.NetworkInterfaceInfo[] = [];
  Object.values(os.networkInterfaces()).forEach((list: any) =>
    list?.forEach?.((addr) => addresses.push(addr))
  );
  const first_addr = addresses.find(
    (addr) => !addr.internal && !_isLocalAddress(addr.address)
  );
  let ret = host;
  if (first_addr) {
    ret += ';' + first_addr.address;
  }
  ret += ';' + process.pid;
  return ret;
}
function _isLocalAddress(address: string): boolean {
  return address?.startsWith?.('fe80') || address?.startsWith?.('169.254');
}
function _defaultErrorLog(...args: any[]): void {
  console.error(...args);
}
function _errorStringify(err: any): string {
  let ret = '';
  if (err && err.stack) {
    ret = String(err.stack);
  } else if (typeof err === 'object') {
    ret = _jsonStringify(err);
  } else {
    ret = String(err);
  }
  return ret;
}
function _jsonStringify(obj: any): string {
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
