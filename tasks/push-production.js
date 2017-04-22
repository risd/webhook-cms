require( 'dotenv' ).config()

module.exports = function(grunt) {
  var wrench = require('wrench');
  var cloudStorage = require('../libs/cloudStorage.js');
  var fs = require('fs');
  var async = require('async');


  var productionBucket = process.env.ASSET_BUCKET || 'cms.webhook.com';
  var productionVersion = process.env.CMS_VERSION || 'v2';
  var distDir = process.env.ASSET_DIRECTORY || 'dist/assets/';

  grunt.registerTask('push-prod', function() {
    var done = this.async();
    var files = wrench.readdirSyncRecursive(distDir);
    var uploadFunctions = [];

    files.forEach(function(file) {
      var source = distDir + file;
      if(!fs.lstatSync(source).isDirectory())
      {

        // fix source map
        if(file.indexOf('.min.js.map') !== -1) {
          var contents = JSON.parse(fs.readFileSync(source).toString());

          var newSources = [];
          contents.sources.forEach(function(src) {
            var parts = src.split('/');
            var newSource = parts[parts.length - 1];

            newSources.push(newSource);
          });

          contents.sources = newSources;

          fs.writeFileSync(source, JSON.stringify(contents));
        }


        if(file.indexOf('.vendor.min.js') !== -1) {
          uploadFunctions.push(function(step) {
            grunt.log.success('uploading ' + source);
            cloudStorage.objects.upload(productionBucket, source, productionVersion + '/assets/vendor.min.js', function() {
              step();
            });
          });
        } else if (file.indexOf('.app.min.css') !== -1) {
          uploadFunctions.push(function(step) {
            grunt.log.success('uploading ' + source);
            cloudStorage.objects.upload(productionBucket, source, productionVersion + '/assets/app.min.css', function() {
              step();
            });
          });
        } else {
          uploadFunctions.push(function(step) {
            grunt.log.success('uploading ' + source);
            cloudStorage.objects.upload(productionBucket, source, productionVersion + '/assets/' + file, function() {
              step();
            });
          });
        }
      }
    });

    async.series(uploadFunctions, function() {
      grunt.log.success('Done');
    });
  });

};
