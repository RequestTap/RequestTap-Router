import { readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname } from "path";
import { logger } from "../utils/logger.js";

export interface RouteGroup {
  id: string;
  name: string;
  description: string;
  priceUsdc: string | null;
  toolIds: string[];
}

export interface DashboardConfig {
  payToAddress: string;
  baseNetwork: string;
  skaleNetwork: string;
  skaleRpcUrl: string;
  skaleBiteContract: string;
  globalPriceUsdc: string | null;
  apiKey: string;
  apiBaseUrl: string;
  routeGroups: RouteGroup[];
  blacklist: string[];
}

const DEFAULT_CONFIG: DashboardConfig = {
  payToAddress: "",
  baseNetwork: "base-sepolia",
  skaleNetwork: "calypso-testnet",
  skaleRpcUrl: "",
  skaleBiteContract: "",
  globalPriceUsdc: null,
  apiKey: "",
  apiBaseUrl: "",
  routeGroups: [],
  blacklist: [],
};

export class ConfigStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): DashboardConfig {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  save(config: DashboardConfig): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + ".tmp";
      writeFileSync(tmp, JSON.stringify(config, null, 2));
      renameSync(tmp, this.filePath);
      logger.info(`Dashboard config saved to ${this.filePath}`);
    } catch (err) {
      logger.error(`Failed to save dashboard config: ${err}`);
      throw err;
    }
  }
}
