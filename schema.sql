
CREATE TABLE `nmc_job` (
  `job_name` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `create_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_disabled` tinyint(1) NOT NULL DEFAULT '0',
  `frequency_secs` int NOT NULL,
  `retry_secs` int NOT NULL DEFAULT '10',
  `max_run_secs` int NOT NULL DEFAULT '600',
  `status` enum('WAITING','RUNNING','ERROR') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'WAITING',
  `run_count` int NOT NULL DEFAULT '0',
  `last_interval_time` timestamp NULL DEFAULT NULL,
  `last_start_time` timestamp NULL DEFAULT NULL,
  `last_result_time` timestamp NULL DEFAULT NULL,
  `last_success_time` timestamp NULL DEFAULT NULL,
  `last_start_worker_id` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `last_result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
