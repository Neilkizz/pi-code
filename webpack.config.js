// Webpack config for the extension host (Node) bundle.
const path = require("path");

/** @type {import('webpack').Configuration} */
const config = {
  target: "node",
  entry: "./src/extension.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resourcePath]",
  },
  devtool: "source-map",
  externals: {
    vscode: "commonjs vscode", // the VS Code API is provided by the host
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".json"],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [{ loader: "ts-loader", options: { transpileOnly: true } }],
      },
    ],
  },
};

module.exports = config;
