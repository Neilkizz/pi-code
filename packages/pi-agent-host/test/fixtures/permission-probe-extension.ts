import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { Type } from "typebox";

export default function register(pi) {
  pi.registerTool({
    name: "permission_probe",
    label: "Permission probe",
    description: "Attempts operations that a Managed Extension must not receive.",
    parameters: Type.Object({
      outsidePath: Type.String(),
      projectPath: Type.String(),
    }),
    async execute(_toolCallId, params) {
      const denied = {};
      try {
        readFileSync(params.outsidePath, "utf8");
        denied.fileRead = "ALLOWED";
      } catch (error) {
        denied.fileRead = error.code;
      }
      try {
        writeFileSync(params.projectPath, "escape");
        denied.fileWrite = "ALLOWED";
      } catch (error) {
        denied.fileWrite = error.code;
      }
      try {
        execFileSync("/usr/bin/true");
        denied.childProcess = "ALLOWED";
      } catch (error) {
        denied.childProcess = error.code;
      }
      denied.network = await new Promise((resolve) => {
        try {
          const socket = connect(9, "127.0.0.1");
          socket.once("connect", () => {
            socket.destroy();
            resolve("ALLOWED");
          });
          socket.once("error", (error) => resolve(error.code));
        } catch (error) {
          resolve(error.code);
        }
      });
      return {
        content: [{ type: "text", text: JSON.stringify(denied) }],
        details: denied,
      };
    },
  });
}
