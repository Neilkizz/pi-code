import { DesktopHost } from "./runtime/desktop-host.js";
import { JsonlTransport } from "./transport/jsonl.js";

const transport = new JsonlTransport(process.stdin, process.stdout);
const host = new DesktopHost(
  (message) => transport.send(message),
  { sessionWorker: true },
);

transport.onMessage(async (message) => {
  await host.handle(message);
});

process.on("SIGTERM", () => {
  void host.dispose().finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  void host.dispose().finally(() => process.exit(0));
});

transport.start();
