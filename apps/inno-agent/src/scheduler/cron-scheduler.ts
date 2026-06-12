import type { JobStore } from "./job-store.js";
import type { ChannelRegistry } from "../channels/channel.js";
import { executeJob } from "./job-runner.js";
import { isCronDue } from "./cron-utils.js";
import { logger } from "../logger.js";

/**
 * In-process cron scheduler.
 * Checks all enabled jobs every 60 seconds and executes any that are due.
 */
export class CronScheduler {
	private interval: ReturnType<typeof setInterval> | null = null;
	private running = new Set<string>(); // prevent overlapping runs

	constructor(
		private jobStore: JobStore,
		private channelRegistry: ChannelRegistry,
	) {}

	/**
	 * Start the scheduler. Checks every 60 seconds.
	 */
	start(): void {
		// Run an initial check after a short delay
		setTimeout(() => this.tick(), 5_000);

		// Then check every 60 seconds
		this.interval = setInterval(() => this.tick(), 60_000);
		logger.info("[scheduler] started, checking jobs every 60s");
	}

	stop(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	private async tick(): Promise<void> {
		const jobs = this.jobStore.list();
		const now = new Date();

		for (const job of jobs) {
			if (!job.enabled) continue;
			if (this.running.has(job.id)) continue; // already running

			if (isCronDue(job.cron, job.timezone, job.lastRunAt, now)) {
				this.running.add(job.id);
				logger.info({ jobId: job.id, jobName: job.name }, "scheduler executing job");

				executeJob(job, this.jobStore, this.channelRegistry, "scheduled")
					.then((result) => {
						if (result.success) {
							logger.info({ jobId: job.id, pushedToChannel: result.pushedToChannel }, "scheduler job completed");
						} else {
							logger.error({ jobId: job.id, error: result.error }, "scheduler job failed");
						}
					})
					.catch((err) => {
						logger.error({ err, jobId: job.id }, "scheduler job error");
					})
					.finally(() => {
						this.running.delete(job.id);
					});
			}
		}
	}
}
