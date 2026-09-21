import { Command } from "commander";
import {
  loadConfig,
  setConfigValue,
  AppConfig,
} from "../config/index.js";

export function createConfigCommand(): Command {
  const cmd = new Command("config").description(
    "Manage CLI configuration",
  );

  cmd
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key: string, value: string) => {
      const validKeys: (keyof AppConfig)[] = [
        "appId",
        "appSecret",
        "region",
        "model",
        "redirectPort",
        "channel",
      ];
      if (!validKeys.includes(key as keyof AppConfig)) {
        console.error(
          `✗ Invalid key. Valid keys: ${validKeys.join(", ")}`,
        );
        process.exit(1);
      }

      let parsedValue: string | number = value;
      if (key === "redirectPort")
        parsedValue = parseInt(value, 10);

      setConfigValue(
        key as keyof AppConfig,
        parsedValue as never,
      );
      console.log(
        `✓ Set ${key} = ${key === "appSecret" ? "****" : value}`,
      );
    });

  cmd
    .command("show")
    .description("Show current configuration")
    .action(() => {
      const config = loadConfig();
      const display = {
        ...config,
        appSecret: config.appSecret ? "****" : "",
      };
      console.log(JSON.stringify(display, null, 2));
    });

  return cmd;
}
