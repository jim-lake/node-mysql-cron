'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.config = config;
exports.isStopped = isStopped;
exports.getLastPollStart = getLastPollStart;
exports.getJobHistoryList = getJobHistoryList;
exports.setWorker = setWorker;
exports.start = start;
exports.stop = stop;
const async_1 = __importDefault(require('async'));
const node_os_1 = __importDefault(require('node:os'));
exports.default = {
  config,
  isStopped,
  setWorker,
  start,
  stop,
  getLastPollStart,
  getJobHistoryList,
};
const MAX_JOB_HISTORY = 100;
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
let g_timeout = null;
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
  _pollLater();
}
function stop() {
  g_isStopped = true;
  if (g_timeout) {
    clearTimeout(g_timeout);
    g_timeout = null;
  }
}
function _pollLater() {
  if (!g_isStopped) {
    g_timeout = setTimeout(_poll.bind(null, _pollLater), g_config.pollInterval);
  }
}
function _poll(done) {
  g_lastPollStart = Date.now();
  let job_list = [];
  async_1.default.series(
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
          async_1.default.each(
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
function _unstallJobs(done) {
  const sql = `
UPDATE ${g_config.jobTable}
SET status = 'ERROR', last_result_time = NOW()
WHERE
  status = 'RUNNING'
  AND last_start_time + INTERVAL max_run_secs SECOND < NOW()
`;
  g_config.pool.query(sql, [], (err, results) => {
    if (err) {
      errorLog('NMC._unstallJobs: sql err:', err);
    } else if (results.affectedRows > 0) {
      errorLog('NMC._unstallJobs: unstalled jobs:', results.affectedRows);
    }
    done(err);
  });
}
function _findJobs(done) {
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
  g_config.pool.query(sql, [], (err, results) => {
    let job_list = [];
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
function _runJob(job, done) {
  const { job_name } = job;
  const job_history = {
    job_name,
    start_time: Date.now(),
  };
  g_jobHistoryList.unshift(job_history);
  g_jobHistoryList.splice(MAX_JOB_HISTORY);
  let next_status;
  let last_result;
  async_1.default.series(
    [
      (done) => _startJob(job, done),
      (done) => {
        try {
          const worker_function = g_workerMap.get(job_name);
          worker_function(job, (err, result) => {
            if (err) {
              errorLog('NMC._runJob:', job_name, 'work error:', err, result);
              last_result = _errorStringify(err);
              next_status = 'ERROR';
            } else {
              last_result = _jsonStringify(result);
              next_status = 'WAITING';
            }
            done();
          });
        } catch (e) {
          errorLog('NMC._runJob:', job_name, 'work threw:', e);
          last_result = _errorStringify(e);
          next_status = 'ERROR';
          done();
        }
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
function _startJob(job, done) {
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
  g_config.pool.query(sql, values, (err, results) => {
    if (err) {
      errorLog('NMC._startJob:', job_name, ' sql err:', err);
    } else if (results.affectedRows === 0) {
      err = 'conflict';
    }
    done(err);
  });
}
function _endJob(params, done) {
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
  g_config.pool.query(sql, values, (err) => {
    if (err) {
      errorLog('NMC._endJob:', job_name, ' sql err:', err);
    }
    done(err);
  });
}
function _getDefaultWorkerId() {
  const host = node_os_1.default.hostname();
  const addresses = [];
  Object.values(node_os_1.default.networkInterfaces()).forEach((list) =>
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
function _isLocalAddress(address) {
  return address?.startsWith?.('fe80') || address?.startsWith?.('169.254');
}
function _defaultErrorLog(...args) {
  console.error(...args);
}
function _errorStringify(err) {
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
function _jsonStringify(obj) {
  let ret = '';
  try {
    ret = JSON.stringify(obj);
  } catch {
    ret = String(obj);
  }
  return ret;
}
//# sourceMappingURL=index.js.map
