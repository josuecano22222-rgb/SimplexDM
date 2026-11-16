/** Jest uses babel-jest; preset-env keeps public/js classes/syntax stable across Node versions. */
module.exports = {
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]]
};
