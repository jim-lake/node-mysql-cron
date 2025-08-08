# TypeScript Example for node-mysql-cron

This example demonstrates type-safe usage of the node-mysql-cron library with comprehensive TypeScript support using tsx for direct execution.

## Features Demonstrated

- **Strict Type Safety**: All functions, interfaces, and return types are properly typed
- **Custom Result Types**: Specific result interfaces for different job types
- **Error Handling**: Type-safe error handling with custom error classes
- **Configuration**: Type-safe database and cron configuration
- **Monitoring**: Real-time job history monitoring with proper typing
- **Graceful Shutdown**: Proper cleanup and shutdown handling
- **Direct TypeScript Execution**: No build step required, runs TypeScript directly with tsx

## Setup

1. Build the main project first:

   ```bash
   cd ..
   npm run build
   cd example
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up your database (MySQL):

   ```bash
   # Create database
   mysql -u root -e 'CREATE DATABASE IF NOT EXISTS nmc_test;'

   # Run schema migration
   mysql -u root nmc_test < ../schema.sql
   ```

4. Configure environment variables (optional):
   ```bash
   export DB_HOST=localhost
   export DB_USER=root
   export DB_PASSWORD=your_password
   export DB_NAME=nmc_test
   ```

## Running the Example

### Quick Demo

```bash
npm run demo
```

### Full Example

```bash
npm start
```

### Development Mode (with watch and auto-restart)

```bash
npm run dev
```

All commands run TypeScript directly without any build step using tsx.

## Code Structure

### Type Definitions

The example defines specific result types for different job categories that extend `JSONValue`:

- `EmailJobResult`: For email sending jobs
- `DataSyncResult`: For data synchronization jobs
- `ReportGenerationResult`: For report generation jobs

### Worker Functions

Three example worker functions demonstrate different patterns:

1. **Email Worker**: Simulates email sending with recipient tracking
2. **Data Sync Worker**: Simulates database synchronization with metrics
3. **Report Worker**: Simulates report generation with file metadata

### Error Handling

Custom `JobError` class provides:

- Job-specific error context
- Retryable vs non-retryable error classification
- Proper error chaining

### Configuration

Type-safe configuration includes:

- Database connection parameters
- Cron system settings
- Error logging configuration
- Job definitions with validation

### Monitoring

Real-time monitoring features:

- Job history tracking
- Performance metrics
- Error reporting
- Status updates

## Key TypeScript Features Used

1. **Interface Definitions**: Strict typing for all data structures
2. **Generic Types**: Leveraging the library's `JSONValue` and `WorkerFunction` types
3. **Union Types**: For status enums and conditional types
4. **Type Guards**: Runtime type checking where needed
5. **Async/Await**: Proper Promise typing throughout
6. **Error Types**: Custom error classes with proper inheritance
7. **Index Signatures**: Making result types compatible with `JSONValue`

## Environment Variables

| Variable      | Default     | Description    |
| ------------- | ----------- | -------------- |
| `DB_HOST`     | `localhost` | MySQL host     |
| `DB_USER`     | `root`      | MySQL username |
| `DB_PASSWORD` | ``          | MySQL password |
| `DB_NAME`     | `nmc_test`  | Database name  |

## Job Types Included

1. **daily_email_report**: Runs daily, sends email reports
2. **hourly_data_sync**: Runs hourly, synchronizes data
3. **weekly_report_generation**: Runs weekly, generates reports

## Files

- `example.ts`: Comprehensive example with multiple worker types
- `demo.ts`: Simple demo for quick testing
- `.gitignore`: Ignores dependencies and logs

## No Build Step Required

This example uses tsx to run TypeScript directly without any compilation step:

- No `tsconfig.json` needed
- No build directory
- Instant execution with full TypeScript support
- Watch mode for development with auto-restart

## Type Safety Benefits

This example demonstrates how TypeScript provides:

- Compile-time error detection
- IntelliSense support
- Refactoring safety
- Documentation through types
- Runtime error reduction
- Proper integration with the main library's type definitions
- Direct execution without build complexity
