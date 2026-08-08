import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase } from "./config/database.js";
import { startScheduledJobTimers } from "./jobs/scheduledJobs.js";

const startServer = async () => {
  try {
    await connectDatabase();

    app.listen(env.port, () => {
      console.log(`API server running on port ${env.port}`);
      startScheduledJobTimers();
    });
  } catch (error) {
    console.error("Failed to start API server", {
      message: error.message
    });
    process.exit(1);
  }
};

startServer();
