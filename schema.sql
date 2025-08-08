
CREATE TABLE `nmc_job` (
  `job_name` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `is_disabled` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('WAITING','RUNNING','ERROR') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'WAITING',
  `last_result` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `last_interval_time` timestamp NULL DEFAULT NULL,
  `last_start_time` timestamp NULL DEFAULT NULL,
  `last_result_time` timestamp NULL DEFAULT NULL,
  `last_success_time` timestamp NULL DEFAULT NULL,
  `last_start_worker_id` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `run_count` int NOT NULL DEFAULT '0',
  `create_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `frequency_secs` int NOT NULL,
  `retry_secs` int NOT NULL DEFAULT '10',
  `max_run_secs` int NOT NULL DEFAULT '600',
  `interval_offset_secs` int NOT NULL DEFAULT '0',
  `update_where_sql` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
