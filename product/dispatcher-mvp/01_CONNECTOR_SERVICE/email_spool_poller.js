"use strict";

const dispatcherUrl =
  process.env.DISPATCHER_LOCAL_URL || "http://127.0.0.1:8788";
const intervalMs = Number(process.env.DISPATCHER_EMAIL_POLL_MS || 5000);

async function pollOnce() {
  const response = await fetch(`${dispatcherUrl}/api/email/poll`, {
    method: "POST",
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`email poll failed: ${JSON.stringify(result)}`);
  }
  return result;
}

async function runPolling() {
  console.log("Email spool poller started.");
  console.log(`Dispatcher: ${dispatcherUrl}`);

  while (true) {
    try {
      const result = await pollOnce();
      if (result.polled > 0) {
        console.log(`Email events accepted: ${result.polled}`);
      }
    } catch (error) {
      console.error(error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

if (require.main === module) {
  runPolling().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  pollOnce,
};
