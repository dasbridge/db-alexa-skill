const path = require('path');
const slsw = require('serverless-webpack');

module.exports = {
    devtool: 'source-map',
    entry: slsw.lib.entries,
    resolve: {
        extensions: [
            '.js',
            '.jsx',
            '.json',
            '.ts',
            '.tsx'
        ]
    },
    output: {
        libraryTarget: 'commonjs',
        path: path.join(__dirname, '.webpack'),
        filename: '[name].js'
    },
    target: 'node',
    module: {
        rules: [
            {test: /\.ts(x?)$/, loader: 'ts-loader'},
            {test: /\.xml$/, loader: 'mustache-loader'}
        ]
    }
};
