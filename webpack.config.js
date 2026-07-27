const CopyPlugin = require("copy-webpack-plugin");
const path = require("path");

module.exports = {
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "index.js",
    clean: true,
    libraryTarget: "commonjs2",
    library: { type: "commonjs2" },
  },
  // `siyuan` 是思源运行时提供的模块（仅类型在 npm 包里），不能打包进产物，
  // 必须作为 external 留给思源加载器在运行期解析（对照官方 plugin-sample）。
  externals: {
    siyuan: "siyuan",
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "plugin.json", to: "plugin.json" },
        { from: "i18n", to: "i18n" },
        { from: "icon.png", to: "icon.png" },
        { from: "preview.png", to: "preview.png" },
        { from: "README.md", to: "README.md" },
        { from: "README_zh_CN.md", to: "README_zh_CN.md" },
      ],
    }),
  ],
};
