const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const fs = require('fs');

/**
 * `npm run webpack` passes `--mode production` but often leaves NODE_ENV unset.
 * Terser (drop_console, minimize) and HTML minify must follow the real webpack mode.
 */
function isWebpackProduction() {
    const mi = process.argv.indexOf('--mode');
    if (mi >= 0 && process.argv[mi + 1] === 'production') {
        return true;
    }
    return process.env.NODE_ENV === 'production';
}
const isProd = isWebpackProduction();

// Generate webpack entry file
require('./scripts/generate-webpack-entry.js');

// Custom plugin to remove individual script tags from HTML
// IMPORTANT: This runs AFTER HtmlWebpackPlugin injects the bundle script
class RemoveScriptTagsPlugin {
    apply(compiler) {
        compiler.hooks.compilation.tap('RemoveScriptTagsPlugin', (compilation) => {
            // Hook into alterAssetTags to ensure bundle is injected
            HtmlWebpackPlugin.getHooks(compilation).alterAssetTags.tapAsync(
                'RemoveScriptTagsPlugin',
                (data, cb) => {
                    // This hook runs when HtmlWebpackPlugin is preparing to inject scripts
                    // We can verify the bundle script will be injected here
                    if (data && data.bodyTags && Array.isArray(data.bodyTags)) {
                        const bundleScript = data.bodyTags.find(tag => 
                            tag.tagName === 'script' && 
                            tag.attributes && 
                            tag.attributes.src && 
                            tag.attributes.src.includes('bundle.')
                        );
                        if (!bundleScript) {
                            console.warn('⚠️  WARNING: Bundle script not found in asset tags!');
                        }
                    }
                    cb(null, data);
                }
            );
            
            HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tapAsync(
                'RemoveScriptTagsPlugin',
                (data, cb) => {
                    if (data && data.html) {
                        // Remove all script tags that point to js/ files (but keep bundle scripts and lib scripts)
                        // Keep bundle.*.js files (webpack output) and lib/ scripts (Cesium, etc.)
                        // Use negative lookahead to exclude bundle and lib
                        data.html = data.html.replace(/<script src="js\/(?!bundle|lib)[^"]+"><\/script>\s*/g, '');
                        
                        // Verify bundle script exists as actual script tag (not in comment)
                        const bundleScriptRegex = /<script[^>]*src=["']js\/bundle\.[^"']+\.js["'][^>]*><\/script>/i;
                        const hasBundle = bundleScriptRegex.test(data.html);
                        
                        if (!hasBundle) {
                            console.error('❌ ERROR: Bundle script NOT found in HTML!');
                            console.error('   HtmlWebpackPlugin did not inject the bundle script.');
                            console.error('   This will cause "Application Initialization Failed" error.');
                            
                            // Try to find the bundle filename and inject it manually
                            const assets = compilation.getAssets();
                            const bundleAsset = assets.find(asset => asset.name.includes('bundle.') && asset.name.endsWith('.js'));
                            if (bundleAsset) {
                                console.log('   Attempting to inject bundle manually...');
                                const bundlePath = bundleAsset.name;
                                const scriptTag = `\n    <script src="${bundlePath}"></script>`;
                                // Inject before </body>
                                data.html = data.html.replace('</body>', scriptTag + '\n</body>');
                                console.log('   ✓ Bundle script injected manually');
                            } else {
                                console.error('   Could not find bundle asset to inject!');
                            }
                        } else {
                            console.log('✓ Bundle script found in HTML');
                        }
                    }
                    cb(null, data);
                }
            );
        });
    }
}

module.exports = {
    entry: './webpack-entry.js',
    output: {
        path: path.resolve(__dirname, 'public-bundled'),
        filename: 'js/bundle.[contenthash].js',
        clean: true,
        // Preserve global scope - don't wrap in IIFE
        globalObject: 'this',
        // Ensure modules are accessible
        library: {
            type: 'window',
            name: 'Meridian'
        },
    },
    mode: isProd ? 'production' : 'development',
    target: 'electron-renderer',
    resolve: {
        extensions: ['.js'],
    },
    module: {
        rules: [],
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: path.join(__dirname, 'public', 'index.html'),
            filename: 'index.html',
            inject: 'body', // Inject scripts before </body>
            scriptLoading: 'blocking',
            minify: isProd ? {
                removeComments: true,
                collapseWhitespace: true,
                removeRedundantAttributes: true,
                useShortDoctype: true,
                removeEmptyAttributes: true,
                removeStyleLinkTypeAttributes: true,
                minifyJS: true,
                minifyCSS: true,
            }             : false,
        }),
        new RemoveScriptTagsPlugin(),
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
            ],
        }),
    ],
    optimization: {
        minimize: isProd,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    compress: {
                        drop_console: isProd, // Remove console in production
                        drop_debugger: true,
                        pure_funcs: isProd ? ['console.log', 'console.info', 'console.debug'] : [],
                        passes: 2, // Multiple passes for better optimization
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
                        properties: false, // Don't mangle properties to avoid breaking CesiumJS
                    },
                },
                extractComments: false,
            }),
        ],
        splitChunks: {
            chunks: 'all',
            cacheGroups: {
                // Separate vendor chunks for better caching
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
                // Separate feature modules for lazy loading
                features: {
                    test: /[\\/]public[\\/]js[\\/]features[\\/]/,
                    name: 'features',
                    priority: 5,
                    minChunks: 1,
                },
                // Core modules
                core: {
                    test: /[\\/]public[\\/]js[\\/]core[\\/]/,
                    name: 'core',
                    priority: 15,
                    minChunks: 1,
                },
            },
        },
        usedExports: true, // Enable tree shaking
        sideEffects: false, // Assume no side effects for better tree shaking
    },
    externals: {
        // Cesium is loaded via script tag, so exclude it from bundling
        cesium: 'Cesium',
    },
    // Handle global variables
    node: {
        __dirname: false,
        __filename: false,
    },
};
