// Webpack config for the webview (browser) React bundle.
const path = require("path");

/** @type {import('webpack').Configuration} */
const config = {
  target: "web",
  entry: "./src/ui/index.tsx",
  output: {
    path: path.resolve(__dirname, "webview/out"),
    filename: "bundle.js",
    libraryTarget: "module",
    publicPath: "",
  },
  experiments: { outputWebAssembly: false, outputModule: true },
  devtool: "source-map",
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
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
};

module.exports = config;
