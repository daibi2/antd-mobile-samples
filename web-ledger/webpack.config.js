const path = require('path');

// webpack 5 so the sample runs on current Node (webpack 3 needs a legacy OpenSSL provider).
module.exports = {
  entry: path.resolve(__dirname, 'src/index.jsx'),
  output: {
    filename: 'index.js',
    path: path.join(__dirname, 'dist'),
    publicPath: '/dist/',
    clean: true,
  },
  resolve: {
    extensions: ['.web.js', '.jsx', '.js', '.json'],
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: { chrome: '80' } }],
              '@babel/preset-react',
            ],
            plugins: [
              ['import', { libraryName: 'antd-mobile', style: 'css' }],
            ],
          },
        },
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.svg$/i,
        use: ['svg-sprite-loader'],
      },
    ],
  },
};
