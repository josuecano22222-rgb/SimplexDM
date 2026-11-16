/**
 * Shared Babel configuration for SimplexDM v2.0.0:
 * - Webpack 5 production/dev renderer bundles target Electron 40 & modern evergreen browsers.
 * - Jest unit/integration tests target the active Node.js runtime via babel-jest.
 */
module.exports = {
    sourceType: 'unambiguous',
    presets: [
        [
            '@babel/preset-env',
            {
                targets: {
                    electron: '40',
                    chrome: '120',
                    firefox: '121',
                    safari: '17',
                    edge: '120',
                },
                modules: false,
                bugfixes: true,
            },
        ],
    ],
    env: {
        test: {
            presets: [
                [
                    '@babel/preset-env',
                    {
                        targets: { node: 'current' },
                    },
                ],
            ],
        },
    },
};
