module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./src'],
          alias: { '@ui': './src/ui', '^regex/(.+)': './ignored/\1', lodash: 'lodash-es' },
        },
      ],
    ],
  };
};
