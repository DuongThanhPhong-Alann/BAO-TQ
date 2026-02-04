import { HttpMethod } from "../lib/http";

export type HttpSource = {
  type: "http";
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type SohuBrowserSource = {
  type: "sohuBrowser";
  startUrls: string[];
  maxLinks?: number;
  headless?: boolean;
  detailConcurrency?: number;
  linkSelector?: string;
  linkAttribute?: string; // default "href"
  detailDelayMs?: number; // delay between detail fetches (when concurrency=1)
  detailRetries?: number; // number of retries after first failure
  waitBetweenTriesMs?: number;
  startUserAgent?: string;
  detailUserAgent?: string;
};

export type GameResSource = {
  type: "gameres";
  startUrl: string; // e.g. https://www.gameres.com/
  batchSize?: number; // kept for parity with n8n; currently used as maxLinks
  maxLinks?: number;
  detailConcurrency?: number;
  detailDelayMs?: number;
  detailRetries?: number;
  waitBetweenTriesMs?: number;
  userAgent?: string;
};

export type GnnSource = {
  type: "gnn";
  sections: Array<{
    startUrl: string;
    source: string;
  }>;
  maxLinksPerSection?: number;
  maxItems?: number; // stop early after reaching this many items (useful for preview)
  detailDelayMs?: number; // delay between detail fetches (sequential)
  detailRetries?: number; // number of retries after first failure
  waitBetweenTriesMs?: number;
  userAgent?: string;
};

export type GamekSource = {
  type: "gamek";
  startUrls: string[];
  pageFrom?: number; // default 1 when pagination is enabled
  pageTo?: number; // default pageFrom
  loadMoreClicks?: number; // only used for homepage (no paging)
  loadMoreSelector?: string; // optional selector for "Xem thêm"
  loadMoreWaitMs?: number; // wait after each click
  maxItems?: number; // stop early after reaching this many items (useful for preview)
  requestDelayMs?: number; // delay between start urls
  retries?: number; // retries per url (after first failure)
  waitBetweenTriesMs?: number;
  userAgent?: string;
};

export type SinaSource = {
  type: "sina";
  startUrl: string; // e.g. https://www.sina.com.cn/
  linkSelectors?: string[]; // where to collect article links from the homepage
  maxLinks?: number;
  detailConcurrency?: number;
  detailDelayMs?: number; // delay between detail fetches (when concurrency=1)
  detailRetries?: number; // number of retries after first failure
  waitBetweenTriesMs?: number;
  userAgent?: string;
};

export type DySource = {
  type: "dy";
  startUrl: string; // e.g. https://www.163.com/dy/media/T1440040368953.html
  maxItems?: number;
  userAgent?: string;
};

export type FxbaogaoArchiveSource = {
  type: "fxbaogaoArchive";
  listUrlTemplate: string; // e.g. https://www.fxbaogao.com/archives/organization/XXX?page={page}
  pageFrom?: number; // default 1
  pageTo?: number; // default pageFrom
  maxItems?: number; // stop early after reaching this many items (useful for preview)
  requestDelayMs?: number; // delay between list page fetches
  retries?: number; // retries per page (after first failure)
  waitBetweenTriesMs?: number;
  userAgent?: string;
  upsertPerPage?: boolean; // runner may upsert after each page (default true)
};

export type AfkLichgameSource = {
  type: "afkLichgame";
  listUrlTemplate: string; // e.g. https://afkmobi.com/buzz-game?page={page}
  pageFrom?: number; // default 1
  pageTo?: number; // default pageFrom
  maxItems?: number; // stop early after reaching this many items (useful for preview)
  requestDelayMs?: number; // delay between list page fetches
  retries?: number; // retries per page (after first failure)
  waitBetweenTriesMs?: number;
  userAgent?: string;
  detailDelayMs?: number;
  detailRetries?: number;
};

export type AfkGameh5Source = {
  type: "afkGameh5";
  listUrlTemplate: string; // e.g. https://afkmobi.com/gameh5?page={page}
  pageFrom?: number; // default 1
  pageTo?: number; // default pageFrom
  maxItems?: number; // stop early after reaching this many items (useful for preview)
  requestDelayMs?: number; // delay between list page fetches
  retries?: number; // retries per page (after first failure)
  waitBetweenTriesMs?: number;
  userAgent?: string;
  detailDelayMs?: number;
  detailRetries?: number;
};

export type AfkGamemobileSource = {
  type: "afkGamemobile";
  listUrlTemplate: string; // e.g. https://afkmobi.com/gamemobile/page/{page}
  pageFrom?: number; // default 1
  pageTo?: number; // default pageFrom
  maxItems?: number; // stop early after reaching this many items (useful for preview)
  requestDelayMs?: number; // delay between list page fetches
  retries?: number; // retries per page (after first failure)
  waitBetweenTriesMs?: number;
  userAgent?: string;
  detailConcurrency?: number;
  detailDelayMs?: number;
  detailRetries?: number;
};

export type AfkTopgameSource = {
  type: "afkTopgame";
  listUrlTemplate: string; // e.g. https://afkmobi.com/topgame?page={page}
  pageFrom?: number; // default 1
  pageTo?: number; // default pageFrom
  maxItems?: number; // stop early after reaching this many items (useful for preview)
  requestDelayMs?: number; // delay between list page fetches
  retries?: number; // retries per page (after first failure)
  waitBetweenTriesMs?: number;
  userAgent?: string;
  detailDelayMs?: number;
  detailRetries?: number;
};

export type AfkTinGameSource = {
  type: "afkTinGame";
  listUrlTemplate: string; // e.g. https://afkmobi.com/tin-game/page/{page}
  pageFrom?: number; // default 1
  pageTo?: number; // default pageFrom
  maxItems?: number; // stop early after reaching this many items (useful for preview)
  requestDelayMs?: number; // delay between list page fetches
  retries?: number; // retries per page (after first failure)
  waitBetweenTriesMs?: number;
  userAgent?: string;
};

export type WorkflowConfig = {
  id: string;
  enabled: boolean;
  cron?: string;
  scheduleTimezone?: string;
  source:
    | HttpSource
    | SohuBrowserSource
    | GameResSource
    | GnnSource
    | GamekSource
    | SinaSource
    | DySource
    | FxbaogaoArchiveSource
    | AfkLichgameSource
    | AfkGameh5Source
    | AfkGamemobileSource
    | AfkTopgameSource
    | AfkTinGameSource;
  responsePath?: string; // required for http source
  transform: string;
  sheets: {
    spreadsheetId: string;
    sheetName: string;
    keyColumn: string;
    appendOnly?: boolean; // when true, only append new rows (skip updates)
    columns: Record<string, string>; // sourceField -> sheetColumnHeader
  };
};
