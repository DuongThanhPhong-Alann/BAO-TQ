import pino from "pino";
import { getConfig } from "./config";

const config = getConfig();

export const logger = pino({
  level: config.logLevel
});
