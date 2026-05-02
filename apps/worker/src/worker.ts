import { config } from "./config";
import { runWorkerBatch } from "./checker";

async function loop() {
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
