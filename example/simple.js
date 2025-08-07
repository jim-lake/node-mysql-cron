const async = require('async');
const mysql = require('mysql');
const os = require('node:os');
const fs = require('node:fs');
const { basename, join } = require('node:path');

const Cron = require('../dist');
const argv = process.argv.slice(2);

function usage() {
  console.log(
    'Usage:',
    basename(process.argv[1]),
    '<host> <user> <password> <database> <cmd>'
  );
}

const jobTable = 'nmc_job';
const cmd = argv[4];

const db_config = {
  host: argv[0],
  user: argv[1],
  password: argv[2],
  database: argv[3],
  timezone: 'UTC',
  debug: false,
  charset: 'utf8mb4',
};
const pool = mysql.createPool(db_config);

const EXAMPLE_JOBS = [
  {
    job_name: 'example_simple1',
    frequency_secs: 10,
    retry_secs: 2,
    max_run_secs: 60,
  },
  {
    job_name: 'example_simple2',
    frequency_secs: 15,
    retry_secs: 2,
    max_run_secs: 60,
  },
  {
    job_name: 'example_simple_error',
    frequency_secs: 10,
    retry_secs: 2,
    max_run_secs: 60,
  },
  {
    job_name: 'example_disabled',
    is_disabled: 1,
    frequency_secs: 10,
    retry_secs: 2,
    max_run_secs: 60,
  },
];
if (cmd === 'schema') {
  const sql = fs.readFileSync(join(__dirname, '../schema.sql'), 'utf8');
  pool.query(sql, [], (err, result) => {
    if (err) {
      _error('create: schema create err:', err);
      process.exit(-1);
    } else {
      _log('create: schema created');
      process.exit(0);
    }
  });
} else if (cmd === 'create') {
  async.eachSeries(
    EXAMPLE_JOBS,
    (job, done) => {
      const sql = `INSERT IGNORE INTO ${jobTable} SET ?`;
      pool.query(sql, [job], (err, result) => {
        if (err) {
          _error('create: insert err:', err);
        } else {
          _log('create: inserted:', job.job_name);
        }
        done();
      });
    },
    () => {
      pool.end();
    }
  );
} else if (cmd === 'delete') {
  const sql = `DELETE FROM ${jobTable} WHERE job_name IN (?)`;
  const values = [EXAMPLE_JOBS.map((job) => job.job_name)];
  pool.query(sql, values, (err, result) => {
    if (err) {
      _error('delete: delete err:', err);
    } else {
      _log('delete: deleted:', result.affectedRows);
    }
    pool.end();
  });
} else if (cmd === 'run') {
  _log('_runJobs: start');
  _runJobs();
} else {
  usage();
}

function _runJobs() {
  const opts = {
    pool,
    jobTable,
    pollInterval: 1 * 1000,
    parallelLimit: 2,
    errorLog: _error,
  };
  Cron.config(opts);
  EXAMPLE_JOBS.forEach(({ job_name }) => {
    Cron.setWorker(job_name, _work);
  });
  Cron.setWorker('example_simple_error', _workError);
  Cron.start();
}

async function _work(job) {
  const { job_name } = job;
  _log('_work: start:', job_name);

  // Simulate async work with a promise
  await new Promise((resolve) => setTimeout(resolve, 1000));

  _log('_work: done:', job_name);
  return { success: 1 };
}

async function _workError(job) {
  const { job_name } = job;
  _log('_workError: start:', job_name);

  // Simulate async work with a promise
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const shouldError = Math.random() > 0.5;
  _log('_workError: done:', job_name, shouldError ? 'with error' : 'success');

  if (shouldError) {
    throw new Error('fake_error');
  }

  return { whooo: 1 };
}
function _log(...args) {
  console.log('[' + new Date().toUTCString() + ']', ...args);
}
function _error(...args) {
  console.error('[' + new Date().toUTCString() + ']', ...args);
}
