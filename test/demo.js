const mysql = require('mysql');
const Cron = require('../dist');

// Simple demo of the async worker functionality
const DB_CONFIG = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'nmc_test',
  timezone: 'UTC',
  charset: 'utf8mb4',
};

const pool = mysql.createPool(DB_CONFIG);

// Configure the cron system
Cron.config({
  pool,
  jobTable: 'nmc_job',
  pollInterval: 2000, // Check every 2 seconds
  parallelLimit: 2,
  errorLog: console.error,
});

// Example async worker functions
async function fetchDataWorker(job) {
  console.log(
    `[${new Date().toISOString()}] Fetching data for job: ${job.job_name}`
  );

  // Simulate async API call
  await new Promise((resolve) => setTimeout(resolve, 1000));

  return {
    jobName: job.job_name,
    timestamp: new Date().toISOString(),
    data: { records: Math.floor(Math.random() * 100), status: 'success' },
  };
}

async function processDataWorker(job) {
  console.log(
    `[${new Date().toISOString()}] Processing data for job: ${job.job_name}`
  );

  // Simulate async processing
  await new Promise((resolve) => setTimeout(resolve, 1500));

  return {
    jobName: job.job_name,
    processed: true,
    itemsProcessed: Math.floor(Math.random() * 50),
    completedAt: new Date().toISOString(),
  };
}

async function errorWorker(job) {
  console.log(
    `[${new Date().toISOString()}] Error worker for job: ${job.job_name}`
  );

  // Simulate some work before error
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (Math.random() > 0.7) {
    throw new Error('Random processing error occurred');
  }

  return { success: true, lucky: true };
}

// Set up workers
Cron.setWorker('fetch_data', fetchDataWorker);
Cron.setWorker('process_data', processDataWorker);
Cron.setWorker('error_prone', errorWorker);

// Start the cron system
console.log('Starting node-mysql-cron demo...');
console.log('The system will process jobs from the database every 2 seconds.');
console.log('Press Ctrl+C to stop.\n');

Cron.start();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  Cron.stop();
  pool.end();
  process.exit(0);
});

// Show status every 10 seconds
setInterval(() => {
  const history = Cron.getJobHistoryList();
  const recentJobs = history.slice(0, 5);

  console.log('\n--- Recent Job History ---');
  recentJobs.forEach((job) => {
    const duration = job.end_time
      ? `${job.end_time - job.start_time}ms`
      : 'running';
    console.log(
      `${job.job_name}: ${job.result_status || 'running'} (${duration})`
    );
  });
  console.log('-------------------------\n');
}, 10000);
