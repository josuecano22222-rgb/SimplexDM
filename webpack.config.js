const fs = require('fs');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

const { isBundledRendererScript } = require('./scripts/generate-webpack-entry.js');

/**
 * `npm run webpack` passes `--mode production` while NODE_ENV may be unset.
 * Terser and HTML minification follow the active webpack mode.
 */
function isWebpackProduction() {
    const mi = process.argv.indexOf('--mode');
    if (mi >= 0 && process.argv[mi + 1] === 'production') {
        return true;
    }
    if (mi >= 0 && process.argv[mi + 1] === 'development') {
        return false;
    }
    return process.env.NODE_ENV === 'production';
}
const isProd = isWebpackProduction();

/**
 * Removes individual bundled `<script src="js/...">` tags from index.html while
 * preserving standalone scripts (`js/simplexThemeSync.js`, `js/vendor/*`),
 * third-party libraries (`lib/*`), and webpack-emitted chunk scripts.
 */
class RemoveScriptTagsPlugin {
    apply(compiler) {
        compiler.hooks.compilation.tap('RemoveScriptTagsPlugin', (compilation) => {
            HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tapAsync(
                'RemoveScriptTagsPlugin',
                (data, cb) => {
                    if (data && data.html) {
                        const emittedAssets = new Set(
                            compilation.getAssets().map((asset) => asset.name.replace(/\\/g, '/'))
                        );

                        data.html = data.html.replace(
                            /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>\s*/gi,
                            (fullTag, _pre, src) => {
                                const clean = src.split('?')[0].split('#')[0].trim().replace(/^\.\//, '');
                                if (emittedAssets.has(clean)) {
                                    return fullTag;
                                }
                                if (/^js\/(?:bundle|runtime|vendor|cesium|core|features)\.[^/]+\.js$/i.test(clean)) {
                                    return fullTag;
                                }
                                if (isBundledRendererScript(clean)) {
                                    return '';
                                }
                                return fullTag;
                            }
                        );

                        const bundleScriptRegex = /<script[^>]*src=["'](?:\.\/)?js\/bundle\.[^"']+\.js["'][^>]*><\/script>/i;
                        if (!bundleScriptRegex.test(data.html)) {
                            const bundleAsset = compilation
                                .getAssets()
                                .find((asset) => asset.name.startsWith('js/bundle.') && asset.name.endsWith('.js'));
                            if (bundleAsset) {
                                const scriptTag = `\n    <script src="${bundleAsset.name}"></script>`;
                                data.html = data.html.replace('</body>', `${scriptTag}\n</body>`);
                            } else {
                                compilation.errors.push(
                                    new Error('RemoveScriptTagsPlugin: webpack bundle script missing from index.html')
                                );
                            }
                        }
                    }
                    cb(null, data);
                }
            );
        });
    }
}

module.exports = {
    entry: {
        bundle: './webpack-entry.js',
    },
    output: {
        path: path.resolve(__dirname, 'public-bundled'),
        filename: 'js/[name].[contenthash].js',
        chunkFilename: 'js/[name].[contenthash].js',
        clean: true,
        globalObject: 'window',
    },
    mode: isProd ? 'production' : 'development',
    // Renderer runs with contextIsolation: true and nodeIntegration: false
    target: 'web',
    resolve: {
        extensions: ['.js'],
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                include: [path.join(__dirname, 'public', 'js')],
                exclude: [
                    /node_modules/,
                    path.join(__dirname, 'public', 'js', 'vendor'),
                    /appI18n\.locale-(?:en|ar)\.js$/,
                ],
                use: {
                    loader: 'babel-loader',
                    options: {
                        cacheDirectory: true,
                        compact: isProd,
                    },
                },
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: path.join(__dirname, 'public', 'index.html'),
            filename: 'index.html',
            inject: 'body',
            scriptLoading: 'blocking',
            minify: isProd
                ? {
                      removeComments: true,
                      collapseWhitespace: true,
                      removeRedundantAttributes: true,
                      useShortDoctype: true,
                      removeEmptyAttributes: true,
                      removeStyleLinkTypeAttributes: true,
                      minifyJS: true,
                      minifyCSS: true,
                  }
                : false,
        }),
        new RemoveScriptTagsPlugin(),
        {
            apply(compiler) {
                compiler.hooks.done.tap('CleanupGeneratedEntryPlugin', () => {
                    const generatedEntry = path.join(__dirname, 'webpack-entry.js');
                    if (!process.env.KEEP_WEBPACK_ENTRY && fs.existsSync(generatedEntry)) {
                        try {
                            fs.unlinkSync(generatedEntry);
                        } catch (_) {
                            // Ignore transient lock errors on Windows
                        }
                    }
                });
            },
        },
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: path.join(__dirname, 'public'),
                    to: path.join(__dirname, 'public-bundled'),
                    globOptions: {
                        ignore: [
                            '**/index.html',
                            '**/js/**/*.js',
                            '**/js/**/*.md',
                        ],
                    },
                },
                // Preserve standalone scripts loaded directly by index.html, landing.html, and admin.html
                {
                    from: path.join(__dirname, 'public', 'js', 'simplexThemeSync.js'),
                    to: path.join(__dirname, 'public-bundled', 'js', 'simplexThemeSync.js'),
                    noErrorOnMissing: true,
                },
                {
                    from: path.join(__dirname, 'public', 'js', 'siteContentClient.js'),
                    to: path.join(__dirname, 'public-bundled', 'js', 'siteContentClient.js'),
                    noErrorOnMissing: true,
                },
                {
                    from: path.join(__dirname, 'public', 'js', 'siteContentAdmin.js'),
                    to: path.join(__dirname, 'public-bundled', 'js', 'siteContentAdmin.js'),
                    noErrorOnMissing: true,
                },
                {
                    from: path.join(__dirname, 'public', 'js', 'vendor'),
                    to: path.join(__dirname, 'public-bundled', 'js', 'vendor'),
                    noErrorOnMissing: true,
                },
            ],
        }),
    ],
    optimization: {
        minimize: isProd,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    compress: {
                        drop_console: isProd,
                        drop_debugger: true,
                        pure_funcs: isProd ? ['console.log', 'console.info', 'console.debug'] : [],
                        passes: 2,
                        unsafe: false,
                        unsafe_comps: false,
                        unsafe_math: false,
                        unsafe_methods: false,
                        unsafe_proto: false,
                        unsafe_regexp: false,
                        unsafe_undefined: false,
                    },
                    format: {
                        comments: false,
                    },
                    mangle: {
                        properties: false,
                    },
                },
                extractComments: false,
            }),
        ],
        // Keep exact registration/execution order across global singleton modules;
        // renderer scripts rely on top-level side effects attaching to `window.*`.
        sideEffects: true,
        usedExports: false,
        splitChunks: {
            chunks: 'async',
            cacheGroups: {
                cesium: {
                    test: /[\\/]node_modules[\\/]cesium[\\/]/,
                    name: 'cesium',
                    priority: 20,
                    enforce: true,
                },
                vendor: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'vendor',
                    priority: 10,
                    reuseExistingChunk: true,
                },
            },
        },
    },
    performance: {
        hints: false,
    },
    externals: {
        cesium: 'Cesium',
    },
};
