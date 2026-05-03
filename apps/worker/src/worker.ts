import { config } from "./config.js";
import { runWorkerBatch } from "./checker.js";

async function loop() {
  if (config.WORKER_RUN_ONCE) {
    await runWorkerBatch();
    return;
  }

  while (true) {
    try {
      await runWorkerBatch();
    } catch (error) {
      console.error("Worker batch failed", error);
    }

    await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_MS));
  }
}

loop().catch((error) => {
  console.error("Worker crashed", error);
  process.exit(1);
});
