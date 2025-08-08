"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = config;
exports.isStopped = isStopped;
exports.getLastPollStart = getLastPollStart;
exports.getJobHistoryList = getJobHistoryList;
exports.setWorker = setWorker;
exports.start = start;
exports.stop = stop;
const node_os_1 = __importDefault(require("node:os"));
const promises_1 = require("node:timers/promises");
const MAX_JOB_HISTORY = 100;
exports.default = {
    config,
    isStopped,
    setWorker,
    start,
    stop,
    getLastPollStart,
    getJobHistoryList,
};
const g_config = {
    pool: null,
    jobTable: 'nmc_job',
    pollInterval: 60 * 1000,
    workerId: _getDefaultWorkerId(),
    parallelLimit: 2,
};
const g_workerMap = new Map();
let errorLog = _defaultErrorLog;
let g_isStopped = true;
let g_lastPollStart = 0;
const g_jobHistoryList = [];
function config(args) {
    Object.assign(g_config, args);
    if (args.errorLog) {
        errorLog = args.errorLog;
    }
}
function isStopped() {
    return g_isStopped;
}
function getLastPollStart() {
    return g_lastPollStart;
}
function getJobHistoryList() {
    return g_jobHistoryList;
}
function setWorker(job_name, worker_function) {
    g_workerMap.set(job_name, worker_function);
}
function start() {
    g_isStopped = false;
    void _run();
}
function stop() {
    g_isStopped = true;
}
async function _run() {
    while (!g_isStopped) {
        let jobs_ran = false;
        try {
            jobs_ran = await _poll();
        }
        catch (e) {
            errorLog('NMC._poll threw:', e);
        }
        if (!jobs_ran) {
            await (0, promises_1.setTimeout)(g_config.pollInterval);
        }
    }
}
async function _poll() {
    g_lastPollStart = Date.now();
    await _unstallJobs();
    const job_list = await _findJobs();
    if (job_list.length > 0) {
        const promises = job_list.map((job) => _runJob(job));
        await Promise.all(promises);
    }
    return job_list.length > 0;
}
async function _unstallJobs() {
    const sql = `
UPDATE ${g_config.jobTable}
SET status = 'ERROR', last_result_time = NOW()
WHERE
  status = 'RUNNING'
  AND last_start_time + INTERVAL max_run_secs SECOND < NOW()
`;
    const { err, results } = await _query(sql, []);
    if (err) {
        errorLog('NMC._unstallJobs: sql err:', err);
        throw err;
    }
    else if (results && results.affectedRows > 0) {
        errorLog('NMC._unstallJobs: unstalled jobs:', results.affectedRows);
    }
}
async function _findJobs() {
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
    const { err, results } = await _query(sql, []);
    if (err) {
        errorLog('NMC._findJob: sql err:', err);
        throw err;
    }
    const job_list = (results || [])
        .filter((job) => g_workerMap.has(job.job_name))
        .slice(0, g_config.parallelLimit);
    return job_list;
}
async function _runJob(job) {
    const { job_name } = job;
    const job_history = { job_name, start_time: Date.now() };
    g_jobHistoryList.unshift(job_history);
    g_jobHistoryList.splice(MAX_JOB_HISTORY);
    let next_status;
    let last_result;
    try {
        await _startJob(job);
        try {
            const worker_function = g_workerMap.get(job_name);
            const result = await worker_function(job);
            last_result = _jsonStringify(result);
            next_status = 'WAITING';
        }
        catch (err) {
            errorLog('NMC._runJob:', job_name, 'work error:', err);
            last_result = _errorStringify(err);
            next_status = 'ERROR';
        }
        job_history.result_status = next_status;
        job_history.result = last_result;
        const opts = { job, next_status, last_result };
        await _endJob(opts);
    }
    catch (err) {
        job_history.err = err;
        throw err;
    }
    finally {
        job_history.end_time = Date.now();
    }
}
async function _startJob(job) {
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
    const { err, results } = await _query(sql, values);
    if (err) {
        errorLog('NMC._startJob:', job_name, ' sql err:', err);
        throw err;
    }
    else if (results && results.affectedRows === 0) {
        throw new Error('conflict');
    }
}
async function _endJob(params) {
    const { job, next_status, last_result } = params;
    const { job_name, frequency_secs, interval_offset_secs } = job;
    const updates = {
        status: next_status,
        last_result,
    };
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
function _getDefaultWorkerId() {
    const host = node_os_1.default.hostname();
    const addresses = [];
    for (const interfaceList of Object.values(node_os_1.default.networkInterfaces())) {
        if (interfaceList) {
            for (const addr of interfaceList) {
                addresses.push(addr);
            }
        }
    }
    const first_addr = addresses.find((addr) => !addr.internal && !_isLocalAddress(addr.address));
    let ret = host;
    if (first_addr) {
        ret += `;${first_addr.address}`;
    }
    ret += `;${process.pid}`;
    return ret;
}
function _isLocalAddress(address) {
    return address?.startsWith?.('fe80') || address?.startsWith?.('169.254');
}
function _defaultErrorLog(...args) {
    console.error(...args);
}
function _errorStringify(err) {
    let ret = '';
    if (err instanceof Error) {
        ret = `${err.stack} ${_jsonStringify({ ...err })}`;
    }
    else if (typeof err === 'object') {
        ret = _jsonStringify(err);
    }
    else {
        ret = String(err);
    }
    return ret;
}
function _jsonStringify(obj) {
    let ret = '';
    try {
        ret = JSON.stringify(obj);
    }
    catch {
        ret = String(obj);
    }
    return ret;
}
async function _query(sql, values) {
    return new Promise((resolve, reject) => {
        if (g_config.pool) {
            g_config.pool.query(sql, values, (err, results) => {
                resolve({ err, results: results });
            });
        }
        else {
            reject(new Error('no_pool'));
        }
    });
}
//# sourceMappingURL=index.js.map