'use strict';

/**
 * JEKAFLY — src/services/cron.js
 *
 * Centralised scheduler for all background jobs.
 * Called once from src/index.js after the server starts.
 *
 * Jobs:
 *  • Survey emails — runs immediately on boot, then every hour.
 *    Finds DELIVERED applications whose visa was delivered 2-7 days
 *    ago and sends a one-time survey email to each customer.
 *
 * Adding new jobs:
 *  1. Import the relevant controller function below.
 *  2. Add a new runJob() call inside startCronJobs().
 *  3. Keep each job in its own named function for easy logging.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wraps a job function with consistent logging and error isolation.
 * A crashing job never takes down the whole process.
 *
 * @param {string}   name  Human-readable job name (shown in logs)
 * @param {Function} fn    Async job function to run
 */
async function runJob(name, fn) {
  const start = Date.now();
  console.log(`[Cron] ▶  ${name} starting…`);
  try {
    await fn();
    console.log(`[Cron] ✓  ${name} completed in ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[Cron] ✗  ${name} failed:`, err.message);
  }
}

// ── Job definitions ───────────────────────────────────────────────────────────

/**
 * Survey emails job.
 * Delegates all logic to the reviews controller — this file only
 * owns the schedule, not the business logic.
 */
async function jobSurveyEmails() {
  const { sendPendingSurveys } = require('../controllers/reviews');
  await sendPendingSurveys();
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Start all scheduled background jobs.
 * Called once after the HTTP server is listening.
 *
 * @param {Object} [options]
 * @param {boolean} [options.runImmediately=true]  Fire each job once on boot
 *                  before the first interval tick.
 */
function startCronJobs({ runImmediately = true } = {}) {
  const jobs = [
    {
      name: 'Survey emails',
      fn: jobSurveyEmails,
      intervalMs: 60 * 60 * 1000, // every hour
    },
    // ── Add future jobs here ──────────────────────────────────────────────────
    // {
    //   name: 'Affiliate commission reconciliation',
    //   fn: jobAffiliateReconcile,
    //   intervalMs: 24 * 60 * 60 * 1000,  // every 24 hours
    // },
  ];

  for (const job of jobs) {
    // Fire immediately on boot so we don't wait a full interval after deploy
    if (runImmediately) {
      runJob(job.name, job.fn);
    }

    // Then repeat on the configured interval
    const timer = setInterval(() => runJob(job.name, job.fn), job.intervalMs);

    // Allow Node to exit cleanly even if an interval is still pending
    if (timer.unref) timer.unref();

    console.log(
      `[Cron] Scheduled "${job.name}" every ${job.intervalMs / 60_000} min`
    );
  }

  console.log(`[Cron] ${jobs.length} job(s) registered.\n`);
}

module.exports = { startCronJobs };

// ─── ADD THIS TO src/services/cron.js ─────────────────────────────────────────
// Append the autoUpdateFlightStatuses job to your existing jobs array:

/*
  In your existing cron.js, find the `jobs` array and add this entry:

  {
    name: 'autoUpdateFlightStatuses',
    intervalMs: 5 * 60 * 1000, // every 5 minutes
    fn: autoUpdateFlightStatuses,
  }

  Then add the function below:
*/

async function autoUpdateFlightStatuses() {
  const prisma = require('../utils/prisma');
  const now = new Date();

  // Mark as DEPARTED any SCHEDULED or BOARDING instance whose departure time has passed
  // We reconstruct the departure datetime from date + departureTime string
  const instances = await prisma.flightInstance.findMany({
    where: { status: { in: ['SCHEDULED', 'BOARDING'] } },
    include: { flight: { select: { departureTime: true } } },
    take: 500,
  });

  const toDepart = [];
  for (const inst of instances) {
    const [h, m] = inst.flight.departureTime.split(':').map(Number);
    const depDt = new Date(inst.date);
    depDt.setUTCHours(h, m, 0, 0);
    if (depDt <= now) toDepart.push(inst.id);
  }

  if (toDepart.length) {
    await prisma.flightInstance.updateMany({
      where: { id: { in: toDepart } },
      data:  { status: 'DEPARTED' },
    });
  }

  // Expire stale seat holds
  await prisma.seatHold.deleteMany({ where: { expiresAt: { lt: now } } });

  return `Departed: ${toDepart.length} flights. Cleared expired holds.`;
}