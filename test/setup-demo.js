const mysql = require('mysql');

const DB_CONFIG = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'nmc_test',
  timezone: 'UTC',
  charset: 'utf8mb4',
};

const pool = mysql.createPool(DB_CONFIG);

const DEMO_JOBS = [
  {
    job_name: 'fetch_data',
    frequency_secs: 30, // Run every 30 seconds
    retry_secs: 5,
    max_run_secs: 60,
    is_disabled: 0,
  },
  {
    job_name: 'process_data',
    frequency_secs: 45, // Run every 45 seconds
    retry_secs: 10,
    max_run_secs: 120,
    is_disabled: 0,
  },
  {
    job_name: 'error_prone',
    frequency_secs: 20, // Run every 20 seconds
    retry_secs: 3,
    max_run_secs: 30,
    is_disabled: 0,
  },
];

async function setupDemoJobs() {
  console.log('Setting up demo jobs...');

  // Clear existing demo jobs
  await new Promise((resolve, reject) => {
    const jobNames = DEMO_JOBS.map((job) => job.job_name);
    pool.query(
      'DELETE FROM nmc_job WHERE job_name IN (?)',
      [jobNames],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  // Insert demo jobs
  for (const job of DEMO_JOBS) {
    await new Promise((resolve, reject) => {
      pool.query('INSERT INTO nmc_job SET ?', [job], (err, result) => {
        if (err) reject(err);
        else {
          console.log(
            `✓ Created job: ${job.job_name} (runs every ${job.frequency_secs}s)`
          );
          resolve(result);
        }
      });
    });
  }

  console.log('\nDemo jobs created successfully!');
  console.log('Run "node test/demo.js" to start the cron system.');

  pool.end();
}

setupDemoJobs().catch((err) => {
  console.error('Error setting up demo jobs:', err);
  pool.end();
  process.exit(1);
});
