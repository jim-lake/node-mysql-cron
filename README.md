# node-mysql-cron

A MySQL-based periodic cron job system with async worker function support.

## Features

- **Async Worker Functions**: Worker functions are now async and return `Promise<JSONValue>`
- **Automatic Error Handling**: Errors are automatically caught and serialized
- **Result Serialization**: Return values are automatically JSON serialized
- **Parallel Job Execution**: Configure how many jobs can run simultaneously
- **Job History Tracking**: Built-in job execution history
- **Stalled Job Detection**: Automatically handles jobs that exceed their max run time
- **Retry Logic**: Failed jobs are automatically retried based on configuration

## Installation

```bash
npm install node-mysql-cron
```

## Usage

### Basic Setup

```javascript
const mysql = require('mysql');
const Cron = require('node-mysql-cron');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'mydb',
  timezone: 'UTC',
});

// Configure the cron system
Cron.config({
  pool,
  jobTable: 'nmc_job',
  pollInterval: 60000, // Check every minute
  parallelLimit: 2,
  errorLog: console.error,
});
```

### Async Worker Functions

Worker functions are now async and should return a JSON-serializable value:

```javascript
// Simple async worker
async function fetchDataWorker(job) {
  console.log(`Processing job: ${job.job_name}`);

  // Simulate async work (API calls, database operations, etc.)
  const response = await fetch('https://api.example.com/data');
  const data = await response.json();

  // Return result (will be JSON serialized automatically)
  return {
    success: true,
    recordsProcessed: data.length,
    timestamp: new Date().toISOString(),
  };
}

// Worker that might throw errors
async function riskyWorker(job) {
  await someAsyncOperation();

  if (someCondition) {
    throw new Error('Something went wrong'); // Will be caught and serialized
  }

  return { status: 'completed' };
}

// Register workers
Cron.setWorker('fetch_data', fetchDataWorker);
Cron.setWorker('risky_job', riskyWorker);

// Start processing
Cron.start();
```

### Database Schema

Create the job table using the provided schema:

```sql
CREATE TABLE `nmc_job` (
  `job_name` varchar(256) NOT NULL,
  `create_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_disabled` tinyint(1) NOT NULL DEFAULT '0',
  `frequency_secs` int NOT NULL,
  `retry_secs` int NOT NULL DEFAULT '10',
  `max_run_secs` int NOT NULL DEFAULT '600',
  `interval_offset_secs` int NOT NULL DEFAULT '0',
  `status` enum('WAITING','RUNNING','ERROR') NOT NULL DEFAULT 'WAITING',
  `run_count` int NOT NULL DEFAULT '0',
  `last_interval_time` timestamp NULL DEFAULT NULL,
  `last_start_time` timestamp NULL DEFAULT NULL,
  `last_result_time` timestamp NULL DEFAULT NULL,
  `last_success_time` timestamp NULL DEFAULT NULL,
  `last_start_worker_id` varchar(256) DEFAULT NULL,
  `last_result` longtext
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Job Management

Insert jobs into the database:

```javascript
const job = {
  job_name: 'daily_report',
  frequency_secs: 86400, // Run daily
  retry_secs: 300, // Retry after 5 minutes on error
  max_run_secs: 1800, // Max 30 minutes runtime
  is_disabled: 0,
};

pool.query('INSERT INTO nmc_job SET ?', [job], (err, result) => {
  if (err) throw err;
  console.log('Job created');
});
```

## API

### Configuration

- `pool`: MySQL connection pool
- `jobTable`: Name of the job table (default: 'nmc_job')
- `pollInterval`: How often to check for jobs in milliseconds (default: 60000)
- `parallelLimit`: Maximum number of jobs to run simultaneously (default: 2)
- `errorLog`: Error logging function (default: console.error)

### Methods

- `Cron.config(options)`: Configure the cron system
- `Cron.setWorker(jobName, workerFunction)`: Register an async worker function
- `Cron.start()`: Start processing jobs
- `Cron.stop()`: Stop processing jobs
- `Cron.isStopped()`: Check if the system is stopped
- `Cron.getLastPollStart()`: Get timestamp of last poll
- `Cron.getJobHistoryList()`: Get recent job execution history

## Testing

Run the test suite:

```bash
npm test
```

Run the demo:

```bash
npm run demo:setup  # Set up demo jobs
npm run demo:run    # Run the demo
```

## Migration from Callback-based Workers

If you're upgrading from a previous version with callback-based workers:

**Old (callback-based):**

```javascript
function oldWorker(job, done) {
  setTimeout(() => {
    done(null, { success: true });
  }, 1000);
}
```

**New (async/await):**

```javascript
async function newWorker(job) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return { success: true };
}
```

## License

MIT
