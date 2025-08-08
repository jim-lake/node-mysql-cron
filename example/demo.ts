#!/usr/bin/env node

/**
 * Simple demo script showing basic TypeScript usage of node-mysql-cron
 * This is a minimal example for quick testing
 */

import mysql from 'mysql';
import Cron, { type Job, type WorkerFunction } from 'node-mysql-cron';

// Simple worker that returns a basic result
const simpleWorker: WorkerFunction = async (job: Job) => {
  console.log(`Processing job: ${job.job_name} (run #${job.run_count})`);

  // Simulate some work
  await new Promise((resolve) => setTimeout(resolve, 1000));

  return {
    success: true,
    message: `Job ${job.job_name} completed successfully`,
    timestamp: new Date().toISOString(),
    runCount: job.run_count,
  };
};

// Another worker that demonstrates error handling
const errorProneWorker: WorkerFunction = async (job: Job) => {
  console.log(`Processing error-prone job: ${job.job_name}`);

  // 30% chance of failure for demonstration
  if (Math.random() < 0.3) {
    throw new Error(`Simulated failure in ${job.job_name}`);
  }

  return {
    success: true,
    message: 'Completed without errors',
    timestamp: new Date().toISOString(),
  };
};

async function runDemo(): Promise<void> {
  console.log('Starting TypeScript demo...');

  // Create database pool
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'nmc_test',
    timezone: 'UTC',
  });

  // Configure cron system
  Cron.config({
    pool,
    jobTable: 'nmc_job',
    pollInterval: 10000, // Check every 10 seconds for demo
    parallelLimit: 2,
    errorLog: console.error,
  });

  // Register workers
  Cron.setWorker('demo_simple', simpleWorker);
  Cron.setWorker('demo_error_prone', errorProneWorker);

  console.log('Workers registered. Starting cron system...');
  Cron.start();

  // Monitor for 60 seconds then stop
  setTimeout(() => {
    console.log('Demo completed. Stopping cron system...');
    Cron.stop();

    // Show job history
    const history = Cron.getJobHistoryList();
    console.log('\nJob History:');
    for (const job of history) {
      const status = job.err ? 'ERROR' : 'SUCCESS';
      const duration = job.end_time ? job.end_time - job.start_time : 'N/A';
      console.log(`- ${job.job_name}: ${status} (${duration}ms)`);
      if (job.result) {
        console.log(`  Result: ${JSON.stringify(job.result)}`);
      }
      if (job.err) {
        console.log(`  Error: ${job.err}`);
      }
    }

    pool.end();
    process.exit(0);
  }, 60000);

  console.log('Demo running for 60 seconds...');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down demo...');
  Cron.stop();
  process.exit(0);
});

// Run the demo
if (require.main === module) {
  runDemo().catch(console.error);
}

export { simpleWorker, errorProneWorker };
