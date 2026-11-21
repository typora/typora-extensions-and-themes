// Ignorance Advanced — `main`, one per window. Only registers the formatters;
// everything else in this extension is declarative.
import { cjkSpacing } from "./format/cjk-spacing.js";

export async function activate(ctx) {
  ctx.subscriptions.push(
    typora.formatters.register("cjk-spacing", (markdown) => cjkSpacing(markdown), { title: "中英文之间加空格" }),
  );
}
