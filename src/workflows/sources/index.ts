import { httpJson } from "../../lib/http";
import { getByPath } from "../../lib/objectPath";
import { WorkflowConfig } from "../types";
import { fetchGameRes } from "./gameres";
import { fetchGnn } from "./gnn";
import { fetchSina } from "./sina";
import { fetchDy } from "./dy";
import { fetchSohuBrowser } from "./sohuBrowser";
import { fetchFxbaogaoArchive } from "./fxbaogao";
import { fetchAfkLichgame } from "./afkLichgame";
import { fetchAfkGameh5 } from "./afkGameh5";
import { fetchAfkGamemobile } from "./afkGamemobile";
import { fetchAfkTopgame } from "./afkTopgame";

export async function fetchWorkflowItems(
  workflow: WorkflowConfig,
  opts: {
    limit?: number;
    onProgress?: (p: { current: number; total: number; text?: string }) => void;
  } = {}
): Promise<any[]> {
  if (workflow.source.type === "http") {
    if (!workflow.source.url || !workflow.source.method) {
      throw new Error(`Workflow "${workflow.id}": invalid http source config`);
    }
    if (!workflow.responsePath) {
      throw new Error(`Workflow "${workflow.id}": responsePath is required for http source`);
    }

    const response = await httpJson<any>(workflow.source.url, {
      method: workflow.source.method,
      headers: workflow.source.headers,
      body: workflow.source.body
    });

    const items = getByPath(response, workflow.responsePath);
    if (!Array.isArray(items)) {
      throw new Error(
        `responsePath "${workflow.responsePath}" did not return an array (got ${typeof items})`
      );
    }
    if (typeof opts.limit === "number") return items.slice(0, opts.limit);
    return items;
  }

  if (workflow.source.type === "sohuBrowser") {
    const startUrls = workflow.source.startUrls;
    if (!Array.isArray(startUrls) || startUrls.length === 0) {
      throw new Error(`Workflow "${workflow.id}": source.startUrls is required`);
    }
    const maxLinks =
      typeof opts.limit === "number"
        ? Math.min(workflow.source.maxLinks ?? opts.limit, opts.limit)
        : workflow.source.maxLinks;

    return await fetchSohuBrowser({
      type: "sohuBrowser",
      startUrls,
      maxLinks,
      headless: workflow.source.headless,
      detailConcurrency: workflow.source.detailConcurrency,
      linkSelector: workflow.source.linkSelector,
      linkAttribute: workflow.source.linkAttribute,
      detailDelayMs: workflow.source.detailDelayMs,
      detailRetries: workflow.source.detailRetries,
      waitBetweenTriesMs: workflow.source.waitBetweenTriesMs,
      startUserAgent: workflow.source.startUserAgent,
      detailUserAgent: workflow.source.detailUserAgent
    });
  }

  if (workflow.source.type === "gameres") {
    if (!workflow.source.startUrl) {
      throw new Error(`Workflow "${workflow.id}": source.startUrl is required`);
    }

    const maxLinks =
      typeof opts.limit === "number"
        ? Math.min(workflow.source.maxLinks ?? opts.limit, opts.limit)
        : workflow.source.maxLinks;
    return await fetchGameRes(
      {
        type: "gameres",
        startUrl: workflow.source.startUrl,
        batchSize: workflow.source.batchSize,
        maxLinks,
        detailConcurrency: workflow.source.detailConcurrency,
        detailDelayMs: workflow.source.detailDelayMs,
        detailRetries: workflow.source.detailRetries,
        waitBetweenTriesMs: workflow.source.waitBetweenTriesMs,
        userAgent: workflow.source.userAgent
      },
      { onProgress: opts.onProgress }
    );
  }

  if (workflow.source.type === "gnn") {
    const sections = workflow.source.sections;
    if (!Array.isArray(sections) || sections.length === 0) {
      throw new Error(`Workflow "${workflow.id}": source.sections is required`);
    }

    return await fetchGnn(
      {
        type: "gnn",
        sections: sections.map((s) => ({ startUrl: s.startUrl, source: s.source })),
        maxLinksPerSection: workflow.source.maxLinksPerSection,
        maxItems: opts.limit,
        detailDelayMs: workflow.source.detailDelayMs,
        detailRetries: workflow.source.detailRetries,
        waitBetweenTriesMs: workflow.source.waitBetweenTriesMs,
        userAgent: workflow.source.userAgent
      },
      { onProgress: opts.onProgress }
    );
  }

  if (workflow.source.type === "sina") {
    if (!workflow.source.startUrl) {
      throw new Error(`Workflow "${workflow.id}": source.startUrl is required`);
    }

    const maxLinks =
      typeof opts.limit === "number"
        ? Math.min(workflow.source.maxLinks ?? opts.limit, opts.limit)
        : workflow.source.maxLinks;

    return await fetchSina(
      {
        type: "sina",
        startUrl: workflow.source.startUrl,
        linkSelectors: workflow.source.linkSelectors,
        maxLinks,
        detailConcurrency: workflow.source.detailConcurrency,
        detailDelayMs: workflow.source.detailDelayMs,
        detailRetries: workflow.source.detailRetries,
        waitBetweenTriesMs: workflow.source.waitBetweenTriesMs,
        userAgent: workflow.source.userAgent
      },
      { onProgress: opts.onProgress }
    );
  }

  if (workflow.source.type === "dy") {
    if (!workflow.source.startUrl) {
      throw new Error(`Workflow "${workflow.id}": source.startUrl is required`);
    }

    const maxItems =
      typeof opts.limit === "number"
        ? Math.min(workflow.source.maxItems ?? opts.limit, opts.limit)
        : workflow.source.maxItems;

    return await fetchDy({
      type: "dy",
      startUrl: workflow.source.startUrl,
      maxItems,
      userAgent: workflow.source.userAgent
    });
  }

  if (workflow.source.type === "fxbaogaoArchive") {
    if (!workflow.source.listUrlTemplate) {
      throw new Error(`Workflow "${workflow.id}": source.listUrlTemplate is required`);
    }

    const maxItems =
      typeof opts.limit === "number"
        ? Math.min(workflow.source.maxItems ?? opts.limit, opts.limit)
        : workflow.source.maxItems;

    return await fetchFxbaogaoArchive(
      {
        type: "fxbaogaoArchive",
        listUrlTemplate: workflow.source.listUrlTemplate,
        pageFrom: workflow.source.pageFrom,
        pageTo: workflow.source.pageTo,
        maxItems,
        requestDelayMs: workflow.source.requestDelayMs,
        retries: workflow.source.retries,
        waitBetweenTriesMs: workflow.source.waitBetweenTriesMs,
        userAgent: workflow.source.userAgent,
        upsertPerPage: workflow.source.upsertPerPage
      },
      { onProgress: opts.onProgress }
    );
  }

  if (workflow.source.type === "afkLichgame") {
    if (!workflow.source.listUrlTemplate) {
      throw new Error(`Workflow "${workflow.id}": source.listUrlTemplate is required`);
    }

    const maxItems =
      typeof opts.limit === "number"
        ? Math.min(workflow.source.maxItems ?? opts.limit, opts.limit)
        : workflow.source.maxItems;

    return await fetchAfkLichgame(
      {
        type: "afkLichgame",
        listUrlTemplate: workflow.source.listUrlTemplate,
        pageFrom: workflow.source.pageFrom,
        pageTo: workflow.source.pageTo,
        maxItems,
        requestDelayMs: workflow.source.requestDelayMs,
        retries: workflow.source.retries,
        waitBetweenTriesMs: workflow.source.waitBetweenTriesMs,
        userAgent: workflow.source.userAgent,
        detailDelayMs: workflow.source.detailDelayMs,
        detailRetries: workflow.source.detailRetries
      },
      { onProgress: opts.onProgress }
    );
  }

  if (workflow.source.type === "afkGameh5") {
    if (!workflow.source.listUrlTemplate) {
      throw new Error(`Workflow "${workflow.id}": source.listUrlTemplate is required`);
    }

    const maxItems =
      typeof opts.limit === "number"
        ? Math.min(workflow.source.maxItems ?? opts.limit, opts.limit)
        : workflow.source.maxItems;

    return await fetchAfkGameh5(
      {
        type: "afkGameh5",
        listUrlTemplate: workflow.source.listUrlTemplate,
        pageFrom: workflow.source.pageFrom,
        pageTo: workflow.source.pageTo,
        maxItems,
        requestDelayMs: workflow.source.requestDelayMs,
        retries: workflow.source.retries,
        waitBetweenTriesMs: workflow.source.waitBetweenTriesMs,
        userAgent: workflow.source.userAgent
      },
      { onProgress: opts.onProgress }
    );
  }

  if (workflow.source.type === "afkGamemobile") {
    if (!workflow.source.listUrlTemplate) {
      throw new Error(`Workflow "${workflow.id}": source.listUrlTemplate is required`);
    }

    const maxItems =
      typeof opts.limit === "number"
        ? Math.min(workflow.source.maxItems ?? opts.limit, opts.limit)
        : workflow.source.maxItems;

    return await fetchAfkGamemobile(
      {
        type: "afkGamemobile",
        listUrlTemplate: workflow.source.listUrlTemplate,
        pageFrom: workflow.source.pageFrom,
        pageTo: workflow.source.pageTo,
        maxItems,
        requestDelayMs: workflow.source.requestDelayMs,
        retries: workflow.source.retries,
        waitBetweenTriesMs: workflow.source.waitBetweenTriesMs,
        userAgent: workflow.source.userAgent
      },
      { onProgress: opts.onProgress }
    );
  }

  if (workflow.source.type === "afkTopgame") {
    if (!workflow.source.listUrlTemplate) {
      throw new Error(`Workflow "${workflow.id}": source.listUrlTemplate is required`);
    }

    const maxItems =
      typeof opts.limit === "number"
        ? Math.min(workflow.source.maxItems ?? opts.limit, opts.limit)
        : workflow.source.maxItems;

    return await fetchAfkTopgame(
      {
        type: "afkTopgame",
        listUrlTemplate: workflow.source.listUrlTemplate,
        pageFrom: workflow.source.pageFrom,
        pageTo: workflow.source.pageTo,
        maxItems,
        requestDelayMs: workflow.source.requestDelayMs,
        retries: workflow.source.retries,
        waitBetweenTriesMs: workflow.source.waitBetweenTriesMs,
        userAgent: workflow.source.userAgent,
        detailDelayMs: workflow.source.detailDelayMs,
        detailRetries: workflow.source.detailRetries
      },
      { onProgress: opts.onProgress }
    );
  }

  throw new Error(`Workflow "${workflow.id}": unsupported source type`);
}
