import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // npm 上的 `siyuan` 包只有 TypeScript 类型声明、没有运行时入口，直接 import 会解析失败。
    // 测试环境统一把 `siyuan` 精准（^siyuan$）指向本地 stub（test/stubs/siyuan.js）。
    alias: [
      {
        find: /^siyuan$/,
        replacement: fileURLToPath(new URL("./test/stubs/siyuan.js", import.meta.url)),
      },
    ],
  },
  test: {
    // 代码依赖 document / FormData / fetch，使用 happy-dom 提供浏览器类环境。
    environment: "happy-dom",
    include: ["test/**/*.test.js"],
  },
});
