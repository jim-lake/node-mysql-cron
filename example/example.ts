import mysql from 'mysql';
import Cron, {
  type Config,
  type Job,
  type JSONValue,
  type WorkerFunction,
  type JobHistory,
} from 'node-mysql-cron';

// Type-safe database configuration
interface DatabaseConfig {
  host: string;
  user: string;
  password: string;
  database: string;
  timezone: 'UTC';
}

// Define specific result types for different job types that extend JSONValue
interface EmailJobResult {
  success: boolean;
  emailsSent: number;
  timestamp: string;
  recipients: string[];
  [key: string]: JSONValue;
}

interface DataSyncResult {
  success: boolean;
  recordsProcessed: number;
  recordsUpdated: number;
  recordsCreated: number;
  errors: string[];
  duration: number;
  [key: string]: JSONValue;
}

interface ReportGenerationResult {
  success: boolean;
  reportPath: string;
  fileSize: number;
  generatedAt: string;
  reportType: 'daily' | 'weekly' | 'monthly';
  [key: string]: JSONValue;
}

// Type-safe error handling
class JobError extends Error {
  constructor(
    message: string,
    public readonly jobName: string,
    public readonly retryable: boolean = true
  ) {
    super(message);
    this.name = 'JobError';
  }
}

// Type-safe database setup
function createDatabasePool(config: DatabaseConfig): mysql.Pool {
  return mysql.createPool({
    ...config,
    acquireTimeout: 60000,
    timeout: 60000,
    connectionLimit: 10,
  });
}

// Type-safe worker functions with proper return types
const emailWorker: WorkerFunction = async (job: Job) => {
  console.log(`Starting email job: ${job.job_name}`);

  // Simulate email sending with proper error handling
  try {
    const recipients = ['user1@example.com', 'user2@example.com'];

    // Simulate async email sending
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Simulate potential failure
    if (Math.random() < 0.1) {
      throw new JobError('SMTP server unavailable', job.job_name, true);
    }

    const result: EmailJobResult = {
      success: true,
      emailsSent: recipients.length,
      timestamp: new Date().toISOString(),
      recipients,
    };

    console.log(`Email job completed: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    if (error instanceof JobError) {
      throw error;
    }
    throw new JobError(
      `Unexpected error in email job: ${error instanceof Error ? error.message : String(error)}`,
      job.job_name,
      false
    );
  }
};

const dataSyncWorker: WorkerFunction = async (job: Job) => {
  console.log(`Starting data sync job: ${job.job_name}`);

  const startTime = Date.now();
  const errors: string[] = [];

  try {
    // Simulate data fetching and processing
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Simulate processing results
    const recordsProcessed = Math.floor(Math.random() * 1000) + 100;
    const recordsUpdated = Math.floor(recordsProcessed * 0.3);
    const recordsCreated = recordsProcessed - recordsUpdated;

    // Simulate some non-critical errors
    if (Math.random() < 0.3) {
      errors.push(
        'Warning: Some records had validation issues but were processed'
      );
    }

    const result: DataSyncResult = {
      success: true,
      recordsProcessed,
      recordsUpdated,
      recordsCreated,
      errors,
      duration: Date.now() - startTime,
    };

    console.log(`Data sync completed: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    throw new JobError(
      `Data sync failed: ${error instanceof Error ? error.message : String(error)}`,
      job.job_name,
      true
    );
  }
};

const reportWorker: WorkerFunction = async (job: Job) => {
  console.log(`Starting report generation: ${job.job_name}`);

  try {
    // Simulate report generation
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Determine report type based on job name
    let reportType: ReportGenerationResult['reportType'] = 'daily';
    if (job.job_name.includes('weekly')) {
      reportType = 'weekly';
    } else if (job.job_name.includes('monthly')) {
      reportType = 'monthly';
    }

    const result: ReportGenerationResult = {
      success: true,
      reportPath: `/reports/${job.job_name}_${Date.now()}.pdf`,
      fileSize: Math.floor(Math.random() * 1000000) + 50000,
      generatedAt: new Date().toISOString(),
      reportType,
    };

    console.log(`Report generated: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    throw new JobError(
      `Report generation failed: ${error instanceof Error ? error.message : String(error)}`,
      job.job_name,
      true
    );
  }
};

// Type-safe configuration function
function configureCronSystem(pool: mysql.Pool): void {
  const config: Partial<Config> = {
    pool,
    jobTable: 'nmc_job',
    pollInterval: 30000, // Check every 30 seconds
    parallelLimit: 3,
    errorLog: (message: unknown, ...args: unknown[]): void => {
      console.error(`[CRON ERROR] ${String(message)}`, ...args);
    },
  };

  Cron.config(config);
}

// Type-safe job registration
function registerWorkers(): void {
  Cron.setWorker('daily_email_report', emailWorker);
  Cron.setWorker('hourly_data_sync', dataSyncWorker);
  Cron.setWorker('weekly_report_generation', reportWorker);
  Cron.setWorker('monthly_report_generation', reportWorker);
}

// Type-safe job creation helper
interface JobDefinition {
  job_name: string;
  frequency_secs: number;
  retry_secs?: number;
  max_run_secs?: number;
  interval_offset_secs?: number;
  is_disabled?: 0 | 1;
}

function createJob(pool: mysql.Pool, jobDef: JobDefinition): Promise<void> {
  return new Promise((resolve, reject) => {
    const job = {
      retry_secs: 300, // 5 minutes default
      max_run_secs: 1800, // 30 minutes default
      interval_offset_secs: 0,
      is_disabled: 0 as const,
      ...jobDef,
    };

    pool.query('INSERT INTO nmc_job SET ?', [job], (err, _result) => {
      if (err) {
        reject(
          new Error(`Failed to create job ${job.job_name}: ${err.message}`)
        );
      } else {
        console.log(`Job created: ${job.job_name}`);
        resolve();
      }
    });
  });
}

// Type-safe monitoring functions
function monitorJobHistory(): void {
  setInterval(() => {
    const history: JobHistory[] = Cron.getJobHistoryList();
    const recentJobs = history.slice(-5); // Get last 5 jobs

    console.log('\n=== Recent Job History ===');
    for (const job of recentJobs) {
      const duration = job.end_time ? job.end_time - job.start_time : 'running';
      const status = job.err ? 'ERROR' : job.end_time ? 'SUCCESS' : 'RUNNING';

      console.log(`${job.job_name}: ${status} (${duration}ms)`);
      if (job.err) {
        console.log(`  Error: ${String(job.err)}`);
      }
      if (job.result) {
        console.log(`  Result: ${JSON.stringify(job.result)}`);
      }
    }
    console.log('========================\n');
  }, 60000); // Every minute
}

// Main application setup
async function main(): Promise<void> {
  try {
    // Type-safe database configuration
    const dbConfig: DatabaseConfig = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'nmc_test',
      timezone: 'UTC',
    };

    console.log('Creating database pool...');
    const pool = createDatabasePool(dbConfig);

    console.log('Configuring cron system...');
    configureCronSystem(pool);

    console.log('Registering workers...');
    registerWorkers();

    // Create sample jobs if they don't exist
    console.log('Creating sample jobs...');
    const sampleJobs: JobDefinition[] = [
      {
        job_name: 'daily_email_report',
        frequency_secs: 86400, // Daily
        max_run_secs: 300, // 5 minutes max
      },
      {
        job_name: 'hourly_data_sync',
        frequency_secs: 3600, // Hourly
        max_run_secs: 1800, // 30 minutes max
      },
      {
        job_name: 'weekly_report_generation',
        frequency_secs: 604800, // Weekly
        max_run_secs: 3600, // 1 hour max
      },
    ];

    for (const jobDef of sampleJobs) {
      try {
        await createJob(pool, jobDef);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('Duplicate entry')
        ) {
          console.log(`Job ${jobDef.job_name} already exists, skipping...`);
        } else {
          throw error;
        }
      }
    }

    console.log('Starting cron system...');
    Cron.start();

    console.log('Starting job monitoring...');
    monitorJobHistory();

    console.log('Cron system is running. Press Ctrl+C to stop.');

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down gracefully...');
      Cron.stop();
      pool.end(() => {
        console.log('Database pool closed.');
        process.exit(0);
      });
    });

    // Keep the process running
    await new Promise(() => {}); // Never resolves
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Type-safe utility functions
function isJobRunning(): boolean {
  return !Cron.isStopped();
}

function getLastPollTime(): Date {
  const timestamp = Cron.getLastPollStart();
  return new Date(timestamp);
}

// Export types for external use
export type {
  EmailJobResult,
  DataSyncResult,
  ReportGenerationResult,
  JobDefinition,
  DatabaseConfig,
};

export { JobError, createJob, isJobRunning, getLastPollTime };

// Run the application if this file is executed directly
if (require.main === module) {
  void main();
}
