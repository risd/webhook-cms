var vendorPaths = ['vendor/bourbon/dist', 'vendor/neat/app/assets/stylesheets', 'vendor/wyrm/sass', 'vendor/font-awesome/scss'];

module.exports = {
  compile: {
    files: { 'tmp/result/assets/app.css': 'app/styles/app.sass' },
    options: {
      includePaths: vendorPaths,
    },
  },
};
