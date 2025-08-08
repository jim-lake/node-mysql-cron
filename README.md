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
- **TypeScript Support**: Full TypeScript support with comprehensive type definitions

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

### TypeScript Setup

```typescript
import mysql from 'mysql';
import Cron, {
  type Job,
  type WorkerFunction,
  type JSONValue,
} from 'node-mysql-cron';

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'mydb',
  timezone: 'UTC',
});

Cron.config({
  pool,
  jobTable: 'nmc_job',
  pollInterval: 60000,
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

### TypeScript Worker Functions

```typescript
const typedWorker: WorkerFunction = async (job: Job): Promise<JSONValue> => {
  console.log(`Processing job: ${job.job_name}`);

  // Your async work here
  await new Promise((resolve) => setTimeout(resolve, 1000));

  return {
    success: true,
    message: `Job ${job.job_name} completed`,
    timestamp: new Date().toISOString(),
  };
};

Cron.setWorker('typed_job', typedWorker);
```

### Database Schema

Create the job table using the provided schema:

```sql
CREATE TABLE `nmc_job` (
  `job_name` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `create_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_disabled` tinyint(1) NOT NULL DEFAULT '0',
  `frequency_secs` int NOT NULL,
  `retry_secs` int NOT NULL DEFAULT '10',
  `max_run_secs` int NOT NULL DEFAULT '600',
  `interval_offset_secs` int NOT NULL DEFAULT '0',
  `status` enum('WAITING','RUNNING','ERROR') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'WAITING',
  `run_count` int NOT NULL DEFAULT '0',
  `last_interval_time` timestamp NULL DEFAULT NULL,
  `last_start_time` timestamp NULL DEFAULT NULL,
  `last_result_time` timestamp NULL DEFAULT NULL,
  `last_success_time` timestamp NULL DEFAULT NULL,
  `last_start_worker_id` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `last_result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
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

### Configuration Options

The `config()` function accepts an options object with the following properties:

- `pool`: MySQL connection pool (required)
- `jobTable`: Name of the job table (default: 'nmc_job')
- `pollInterval`: How often to check for jobs in milliseconds (default: 60000)
- `workerId`: Unique identifier for this worker instance (default: auto-generated from hostname, IP, and PID)
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

### TypeScript Types

The library exports the following TypeScript types:

```typescript
interface ConfigParams {
  pool: Pool;
  jobTable?: string;
  pollInterval?: number;
  workerId?: string;
  parallelLimit?: number;
  errorLog?: (...args: readonly unknown[]) => void;
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

interface JobHistory {
  job_name: string;
  start_time: number;
  end_time?: number;
  err?: unknown;
  result_status?: unknown;
  result?: unknown;
}

type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

type WorkerFunction = (job: Job) => Promise<JSONValue>;
```

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

## Examples

### JavaScript Example

See `example/simple.js` for a complete JavaScript example.

### TypeScript Examples

- `example/demo.ts` - Simple TypeScript demo
- `example/example.ts` - Comprehensive TypeScript example with type safety

Run TypeScript examples:

```bash
cd example
npm install
npm run demo    # Simple demo
npm start       # Full example
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
