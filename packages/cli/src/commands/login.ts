import { Command } from "commander";
import { login as loginFn } from "../auth/login.js";

export function createLoginCommand(): Command {
  return new Command("login")
    .description("Authenticate with Lark via OAuth")
    .action(async () => {
      try {
        const token = await loginFn();
        console.log(`✓ Logged in as ${token.email ?? "unknown"}`);
      } catch (err) {
        console.error(
          `✗ Login failed: ${err instanceof Error ? err.message : err}`,
        );
        process.exit(1);
      }
    });
}
