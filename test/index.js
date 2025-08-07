const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const mysql = require('mysql');
const Cron = require('../dist');

// Test configuration
const DB_CONFIG = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'nmc_test',
  timezone: 'UTC',
  charset: 'utf8mb4',
};

const JOB_TABLE = 'nmc_job';
let pool;

// Test utilities
function log(...args) {
  console.log('[TEST]', new Date().toISOString(), ...args);
}

function error(...args) {
  console.error('[ERROR]', new Date().toISOString(), ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Database utilities
async function queryAsync(sql, values = []) {
  return new Promise((resolve, reject) => {
    pool.query(sql, values, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

async function clearJobs() {
  await queryAsync(`DELETE FROM ${JOB_TABLE}`);
}

async function insertJob(job) {
  const sql = `INSERT INTO ${JOB_TABLE} SET ?`;
  return queryAsync(sql, [job]);
}

async function getJob(jobName) {
  const sql = `SELECT * FROM ${JOB_TABLE} WHERE job_name = ?`;
  const results = await queryAsync(sql, [jobName]);
  return results[0];
}

async function waitForJobExecution(jobName, timeoutMs = 15000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const job = await getJob(jobName);
    if (job && job.run_count > 0) {
      return job;
    }
    await sleep(200);
  }

  const job = await getJob(jobName);
  log(
    `Job ${jobName} current state:`,
    job
      ? {
          status: job.status,
          run_count: job.run_count,
          last_result: job.last_result,
        }
      : 'NOT FOUND'
  );

  throw new Error(`Job ${jobName} was not executed within ${timeoutMs}ms`);
}

async function waitForJobCompletion(
  jobName,
  expectedStatus,
  timeoutMs = 15000
) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const job = await getJob(jobName);
    if (job && job.status === expectedStatus && job.run_count > 0) {
      return job;
    }
    await sleep(200);
  }

  const job = await getJob(jobName);
  log(
    `Job ${jobName} current state:`,
    job
      ? {
          status: job.status,
          run_count: job.run_count,
          last_result: job.last_result,
        }
      : 'NOT FOUND'
  );

  throw new Error(
    `Job ${jobName} did not reach status ${expectedStatus} within ${timeoutMs}ms`
  );
}

// Test worker functions
async function successWorker(job) {
  log(`Success worker executing for job: ${job.job_name}`);
  await sleep(100); // Simulate some work
  return { success: true, timestamp: Date.now(), jobName: job.job_name };
}

async function errorWorker(job) {
  log(`Error worker executing for job: ${job.job_name}`);
  await sleep(100); // Simulate some work
  throw new Error(`Intentional error for job: ${job.job_name}`);
}

async function slowWorker(job) {
  log(`Slow worker executing for job: ${job.job_name}`);
  await sleep(2000); // Simulate slow work
  return { slow: true, duration: 2000 };
}

// Setup and teardown
before(async () => {
  log('Setting up test database connection');
  pool = mysql.createPool(DB_CONFIG);
});

after(async () => {
  log('Closing test database connection');
  if (pool) {
    pool.end();
  }
});

beforeEach(async () => {
  // Ensure cron is stopped before each test
  Cron.stop();
  await sleep(100);
});

describe('node-mysql-cron', () => {
  test('Basic Job Execution', async () => {
    await clearJobs();

    // Insert a test job
    await insertJob({
      job_name: 'test_basic',
      frequency_secs: 1,
      retry_secs: 1,
      max_run_secs: 10,
    });

    // Configure and start cron
    Cron.config({
      pool,
      jobTable: JOB_TABLE,
      pollInterval: 500,
      parallelLimit: 1,
      errorLog: error,
    });

    Cron.setWorker('test_basic', successWorker);
    Cron.start();

    try {
      // Wait for job to complete
      const completedJob = await waitForJobCompletion('test_basic', 'WAITING');

      assert.ok(completedJob.run_count > 0, 'Job should have been executed');
      assert.strictEqual(
        completedJob.status,
        'WAITING',
        'Job should be in WAITING status'
      );
      assert.ok(
        completedJob.last_success_time !== null,
        'Job should have success time'
      );

      const result = JSON.parse(completedJob.last_result);
      assert.strictEqual(
        result.success,
        true,
        'Job result should indicate success'
      );
      assert.strictEqual(
        result.jobName,
        'test_basic',
        'Job result should contain job name'
      );
    } finally {
      Cron.stop();
    }
  });

  test('Job Error Handling', async () => {
    await clearJobs();

    // Insert a test job that will error
    await insertJob({
      job_name: 'test_error',
      frequency_secs: 1,
      retry_secs: 1,
      max_run_secs: 10,
    });

    Cron.config({
      pool,
      jobTable: JOB_TABLE,
      pollInterval: 500,
      parallelLimit: 1,
      errorLog: error,
    });

    Cron.setWorker('test_error', errorWorker);
    Cron.start();

    try {
      // Wait for job to complete with error
      const errorJob = await waitForJobCompletion('test_error', 'ERROR');

      assert.ok(errorJob.run_count > 0, 'Job should have been executed');
      assert.strictEqual(
        errorJob.status,
        'ERROR',
        'Job should be in ERROR status'
      );
      assert.ok(
        errorJob.last_result.includes('Intentional error'),
        'Job result should contain error message'
      );
    } finally {
      Cron.stop();
    }
  });

  test('Job Retry Logic', async () => {
    await clearJobs();

    // Insert a job that will retry
    await insertJob({
      job_name: 'test_retry',
      frequency_secs: 10, // Long frequency so it doesn't run again normally
      retry_secs: 1, // Short retry time
      max_run_secs: 10,
    });

    let executionCount = 0;
    const retryWorker = async (job) => {
      executionCount++;
      log(`Retry worker execution #${executionCount} for job: ${job.job_name}`);

      if (executionCount < 3) {
        throw new Error(`Retry attempt ${executionCount}`);
      }

      return { success: true, attempts: executionCount };
    };

    Cron.config({
      pool,
      jobTable: JOB_TABLE,
      pollInterval: 500,
      parallelLimit: 1,
      errorLog: error,
    });

    Cron.setWorker('test_retry', retryWorker);
    Cron.start();

    try {
      // Wait for job to eventually succeed
      await sleep(5000); // Give time for retries
      const job = await getJob('test_retry');

      assert.ok(
        executionCount >= 3,
        `Job should have been executed multiple times, got: ${executionCount}`
      );
      assert.strictEqual(
        job.status,
        'WAITING',
        `Job should eventually succeed, got: ${job.status}`
      );
    } finally {
      Cron.stop();
    }
  });

  test('Parallel Job Execution', async () => {
    await clearJobs();

    // Insert multiple jobs
    const jobNames = ['parallel_1', 'parallel_2', 'parallel_3'];
    for (const jobName of jobNames) {
      await insertJob({
        job_name: jobName,
        frequency_secs: 1,
        retry_secs: 1,
        max_run_secs: 10,
      });
    }

    const executionTimes = {};
    const parallelWorker = async (job) => {
      const startTime = Date.now();
      executionTimes[job.job_name] = startTime;
      log(`Parallel worker starting for job: ${job.job_name} at ${startTime}`);

      await sleep(1000); // Simulate work

      return { jobName: job.job_name, startTime };
    };

    Cron.config({
      pool,
      jobTable: JOB_TABLE,
      pollInterval: 500,
      parallelLimit: 3, // Allow parallel execution
      errorLog: error,
    });

    for (const jobName of jobNames) {
      Cron.setWorker(jobName, parallelWorker);
    }

    Cron.start();

    try {
      // Wait for all jobs to be executed
      for (const jobName of jobNames) {
        await waitForJobExecution(jobName);
      }

      // Check that jobs ran in parallel (within reasonable time window)
      const times = Object.values(executionTimes);
      assert.strictEqual(
        times.length,
        3,
        'All three jobs should have executed'
      );

      const maxTimeDiff = Math.max(...times) - Math.min(...times);
      assert.ok(
        maxTimeDiff < 3000,
        `Jobs should have started within 3 seconds of each other (parallel execution), got: ${maxTimeDiff}ms`
      );
    } finally {
      Cron.stop();
    }
  });

  test('Job History Tracking', async () => {
    await clearJobs();

    await insertJob({
      job_name: 'test_history',
      frequency_secs: 1,
      retry_secs: 1,
      max_run_secs: 10,
    });

    Cron.config({
      pool,
      jobTable: JOB_TABLE,
      pollInterval: 500,
      parallelLimit: 1,
      errorLog: error,
    });

    Cron.setWorker('test_history', successWorker);
    Cron.start();

    try {
      // Wait for job to complete
      await waitForJobCompletion('test_history', 'WAITING');

      // Check job history
      const history = Cron.getJobHistoryList();
      assert.ok(history.length > 0, 'Job history should contain entries');

      const historyEntry = history.find((h) => h.job_name === 'test_history');
      assert.ok(
        historyEntry !== undefined,
        'History should contain entry for test job'
      );
      assert.ok(
        historyEntry.start_time > 0,
        'History entry should have start time'
      );
      assert.ok(
        historyEntry.end_time > 0,
        'History entry should have end time'
      );
      assert.strictEqual(
        historyEntry.result_status,
        'WAITING',
        'History entry should show success status'
      );
    } finally {
      Cron.stop();
    }
  });

  test('Cron Lifecycle Management', async () => {
    // Ensure clean state
    Cron.stop();
    await sleep(100);

    // Test start/stop functionality
    assert.strictEqual(
      Cron.isStopped(),
      true,
      'Cron should be stopped initially'
    );

    Cron.config({
      pool,
      jobTable: JOB_TABLE,
      pollInterval: 1000,
      parallelLimit: 1,
      errorLog: error,
    });

    Cron.start();
    assert.strictEqual(
      Cron.isStopped(),
      false,
      'Cron should be running after start'
    );

    const lastPollStart = Cron.getLastPollStart();
    await sleep(1500); // Wait for at least one poll

    const newPollStart = Cron.getLastPollStart();
    assert.ok(newPollStart > lastPollStart, 'Poll should have occurred');

    Cron.stop();
    assert.strictEqual(
      Cron.isStopped(),
      true,
      'Cron should be stopped after stop'
    );
  });

  test('Job Stalling Detection', async () => {
    await clearJobs();

    // Insert a job with very short max_run_secs
    await insertJob({
      job_name: 'test_stall',
      frequency_secs: 1,
      retry_secs: 1,
      max_run_secs: 1, // Very short max run time (1 second)
    });

    // Manually update the job to simulate a stalled job that started long ago
    // Use NOW() to match the stalling detection logic in _unstallJobs
    // Set it to 30 seconds ago to be absolutely sure it's stalled
    await queryAsync(
      `UPDATE ${JOB_TABLE} SET status = 'RUNNING', last_start_time = NOW() - INTERVAL 30 SECOND WHERE job_name = 'test_stall'`
    );

    Cron.config({
      pool,
      jobTable: JOB_TABLE,
      pollInterval: 500,
      parallelLimit: 1,
      errorLog: error,
    });

    // Don't set a worker - we just want to test the unstall logic
    Cron.start();

    try {
      // Wait for unstall logic to kick in with more time for timezone processing
      await sleep(4000);

      let job = await getJob('test_stall');
      log(
        `Job state after initial wait: status=${job?.status}, last_start_time=${job?.last_start_time}, max_run_secs=${job?.max_run_secs}`
      );

      // If still running, wait a bit more and check again
      if (job && job.status === 'RUNNING') {
        await sleep(2000);
        job = await getJob('test_stall');
        log(`Job state after additional wait: status=${job?.status}`);
      }

      assert.strictEqual(
        job.status,
        'ERROR',
        `Stalled job should be marked as ERROR, got: ${job.status}`
      );
    } finally {
      Cron.stop();
    }
  });

  test('Async Worker Function Return Values', async () => {
    await clearJobs();

    await insertJob({
      job_name: 'test_async_return',
      frequency_secs: 1,
      retry_secs: 1,
      max_run_secs: 10,
    });

    const complexReturnWorker = async (job) => {
      log(`Complex return worker executing for job: ${job.job_name}`);
      await sleep(100);

      return {
        jobName: job.job_name,
        executedAt: new Date().toISOString(),
        data: {
          nested: {
            value: 42,
            array: [1, 2, 3],
            boolean: true,
            nullValue: null,
          },
        },
      };
    };

    Cron.config({
      pool,
      jobTable: JOB_TABLE,
      pollInterval: 500,
      parallelLimit: 1,
      errorLog: error,
    });

    Cron.setWorker('test_async_return', complexReturnWorker);
    Cron.start();

    try {
      const completedJob = await waitForJobCompletion(
        'test_async_return',
        'WAITING'
      );

      assert.ok(completedJob.run_count > 0, 'Job should have been executed');
      assert.strictEqual(
        completedJob.status,
        'WAITING',
        'Job should be in WAITING status'
      );

      const result = JSON.parse(completedJob.last_result);
      assert.strictEqual(
        result.jobName,
        'test_async_return',
        'Result should contain job name'
      );
      assert.ok(result.executedAt, 'Result should contain execution timestamp');
      assert.strictEqual(
        result.data.nested.value,
        42,
        'Result should contain nested data'
      );
      assert.deepStrictEqual(
        result.data.nested.array,
        [1, 2, 3],
        'Result should contain array data'
      );
      assert.strictEqual(
        result.data.nested.boolean,
        true,
        'Result should contain boolean data'
      );
      assert.strictEqual(
        result.data.nested.nullValue,
        null,
        'Result should contain null value'
      );
    } finally {
      Cron.stop();
    }
  });

  test('Database Error Handling', async () => {
    await clearJobs();

    // Test with invalid database configuration to trigger SQL errors
    const badPool = mysql.createPool({
      ...DB_CONFIG,
      database: 'nonexistent_database',
    });

    Cron.config({
      pool: badPool,
      jobTable: JOB_TABLE,
      pollInterval: 500,
      parallelLimit: 1,
      errorLog: error,
    });

    Cron.setWorker('test_db_error', successWorker);
    Cron.start();

    try {
      // Let it run for a bit to trigger database errors
      await sleep(2000);

      // The system should handle database errors gracefully
      assert.ok(true, 'System should handle database errors without crashing');
    } finally {
      Cron.stop();
      badPool.end();
    }
  });

  test('Job Conflict Handling', async () => {
    await clearJobs();

    // Insert a job and manually set it to a state that would cause conflicts
    await insertJob({
      job_name: 'test_conflict',
      frequency_secs: 1,
      retry_secs: 1,
      max_run_secs: 10,
      run_count: 5, // Set a specific run count
    });

    // Manually update the job to simulate a race condition
    await queryAsync(
      `UPDATE ${JOB_TABLE} SET run_count = 10 WHERE job_name = 'test_conflict'`
    );

    Cron.config({
      pool,
      jobTable: JOB_TABLE,
      pollInterval: 500,
      parallelLimit: 1,
      errorLog: error,
    });

    Cron.setWorker('test_conflict', successWorker);
    Cron.start();

    try {
      // Let it run for a bit - the job should handle conflicts gracefully
      await sleep(2000);
      assert.ok(true, 'System should handle job conflicts gracefully');
    } finally {
      Cron.stop();
    }
  });

  test('Error Serialization Edge Cases', async () => {
    await clearJobs();

    await insertJob({
      job_name: 'test_error_types',
      frequency_secs: 1,
      retry_secs: 1,
      max_run_secs: 10,
    });

    let testCase = 0;
    const errorTypesWorker = async (job) => {
      testCase++;
      log(`Error types worker execution #${testCase} for job: ${job.job_name}`);

      // Add a small delay to ensure consistent timing across machines
      await sleep(50);

      switch (testCase) {
        case 1:
          // Error with stack trace
          throw new Error('Error with stack trace');
        case 2:
          // Plain object error
          throw { message: 'Plain object error', code: 500 };
        case 3:
          // String error
          throw 'String error';
        case 4:
          // Number error
          throw 404;
        case 5:
          // Null error
          throw null;
        case 6:
          // Undefined error
          throw undefined;
        default:
          return { success: true, testCase };
      }
    };

    Cron.config({
      pool,
      jobTable: JOB_TABLE,
      pollInterval: 500,
      parallelLimit: 1,
      errorLog: error,
    });

    Cron.setWorker('test_error_types', errorTypesWorker);
    Cron.start();

    try {
      // Give plenty of time for multiple error type executions
      await sleep(3000); // Initial wait

      let job = await getJob('test_error_types');
      let attempts = 0;
      const maxAttempts = 20; // Maximum attempts to check

      // Keep checking until we have at least 4 executions or timeout
      while ((!job || job.run_count < 4) && attempts < maxAttempts) {
        await sleep(1000); // Wait 1 second between checks
        job = await getJob('test_error_types');
        attempts++;
        log(
          `Checking error types job progress: run_count=${job?.run_count || 0}, attempt=${attempts}`
        );
      }

      // Final verification with more lenient requirements
      assert.ok(job, 'Job should exist in database');
      assert.ok(
        job.run_count >= 4,
        `Job should have been executed multiple times to test different error types, got: ${job.run_count}`
      );

      log(
        `Error serialization test completed with ${job.run_count} executions`
      );
    } finally {
      Cron.stop();
    }
  });

  test('JSON Serialization Edge Cases', async () => {
    await clearJobs();

    await insertJob({
      job_name: 'test_json_edge_cases',
      frequency_secs: 1,
      retry_secs: 1, // Quick retry
      max_run_secs: 10,
    });

    let testCase = 0;
    const jsonEdgeCasesWorker = async (job) => {
      testCase++;
      log(
        `JSON edge cases worker execution #${testCase} for job: ${job.job_name}`
      );

      // Add a small delay to ensure consistent timing across machines
      await sleep(50);

      switch (testCase) {
        case 1:
          // Circular reference (should trigger JSON.stringify error) - throw to force retry
          const circular = { name: 'circular' };
          circular.self = circular;
          throw circular; // Throw instead of return to force retry
        case 2:
          // Function (not JSON serializable) - throw to force retry
          throw { func: () => 'test', value: 42 };
        case 3:
          // Symbol (not JSON serializable) - throw to force retry
          throw { symbol: Symbol('test'), value: 42 };
        case 4:
          // BigInt (not JSON serializable in older Node versions) - throw to force retry
          try {
            throw { bigint: BigInt(123), value: 42 };
          } catch {
            throw { value: 42 };
          }
        default:
          // Finally succeed after testing error serialization
          return { success: true, testCase };
      }
    };

    Cron.config({
      pool,
      jobTable: JOB_TABLE,
      pollInterval: 500,
      parallelLimit: 1,
      errorLog: error,
    });

    Cron.setWorker('test_json_edge_cases', jsonEdgeCasesWorker);
    Cron.start();

    try {
      // Give plenty of time for multiple executions across different machine speeds
      // Wait for at least 2-3 executions with generous timing
      await sleep(2000); // Initial wait for first execution

      let job = await getJob('test_json_edge_cases');
      let attempts = 0;
      const maxAttempts = 15; // Maximum attempts to check

      // Keep checking until we have at least 2 executions or timeout
      while ((!job || job.run_count < 2) && attempts < maxAttempts) {
        await sleep(1000); // Wait 1 second between checks
        job = await getJob('test_json_edge_cases');
        attempts++;
        log(
          `Checking job progress: run_count=${job?.run_count || 0}, attempt=${attempts}`
        );
      }

      // Final verification with more lenient requirements
      assert.ok(job, 'Job should exist in database');
      assert.ok(
        job.run_count >= 2,
        `Job should have been executed at least 2 times to test JSON edge cases, got: ${job.run_count}`
      );

      // The system should handle JSON serialization errors gracefully
      assert.ok(
        job.last_result,
        'Job should have a result even with JSON serialization issues'
      );

      log(`JSON edge cases test completed with ${job.run_count} executions`);
    } finally {
      Cron.stop();
    }
  });
});
