import { transformSohu } from "./sohu";
import { transformGameRes } from "./gameres";
import { transformGnn } from "./gnn";
import { transformSina } from "./sina";
import { transformDy } from "./dy";
import { transformFxbaogao } from "./fxbaogao";
import { transformAfkLichgame } from "./afkLichgame";
import { transformAfkGameh5 } from "./afkGameh5";
import { transformAfkGamemobile } from "./afkGamemobile";
import { transformAfkTopgame } from "./afkTopgame";

export type TransformFn = (item: any) => Record<string, unknown>;

export function getTransform(name: string): TransformFn {
  if (name === "sohu") return transformSohu;
  if (name === "gameres") return transformGameRes;
  if (name === "gnn") return transformGnn;
  if (name === "sina") return transformSina;
  if (name === "dy") return transformDy;
  if (name === "fxbaogao") return transformFxbaogao;
  if (name === "afkLichgame") return transformAfkLichgame;
  if (name === "afkGameh5") return transformAfkGameh5;
  if (name === "afkGamemobile") return transformAfkGamemobile;
  if (name === "afkTopgame") return transformAfkTopgame;
  throw new Error(`Unknown transform "${name}"`);
}
