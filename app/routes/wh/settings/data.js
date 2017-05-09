export default Ember.Route.extend({
  
  baseUrl: ( window.ENV.uploadUrl.substr(-1) === '/' )
    ? window.ENV.uploadUrl
    : window.ENV.uploadUrl + '/',

  model: function () {

    var siteName = this.get('session.site.name');
    var siteToken = this.get('session.site.token');
    var baseUrl = this.baseUrl;

    return new Ember.RSVP.Promise(function (resolve, reject) {
      var backupsRef = window.ENV.firebaseRoot.child('management/backups');
      backupsRef.once('value', function (snapshot) {

        var backups = Ember.$.map(snapshot.val() || [], function (timestamp) {
          return {
            fileName: siteName + '-' + moment(timestamp).format() + '.json',
            url: baseUrl + 'backup-snapshot/?site=' + siteName + '&token=' + siteToken + '&timestamp=' + timestamp,
            timestamp: timestamp
          };
        });

        Ember.run(null, resolve, backups.reverse());
      });
    });
  },

  setupController: function (controller) {
    var baseUrl = this.baseUrl;

    controller.set('deleteOption', 'data');
    controller.set('wordpressFile', null);

    // controller.set('dataBackup', null);
    controller.set('dataError', null);

    controller.set('downloadLink', baseUrl + 'download/?site=' +this.get('session.site.name') + '&token=' + this.get('session.site.token'));
    controller.set('downloadFileName', this.get('session.site.name'));

    window.ENV.firebaseRoot.child('management/sites').child(this.get('session.site.name')).child('api-key').once('value', function(snap) {
      var val = snap.val();

      if(!val) {
        //Generate and set
        var newKey = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {var r = Math.random()*16|0,v=c==='x'?r:r&0x3|0x8;return v.toString(16);});
        
        window.ENV.firebaseRoot.child('management/sites').child(this.get('session.site.name')).child('api-key').set(newKey, function(err) {
          controller.set('apiKey', newKey);
        }.bind(this));
      } else {
        controller.set('apiKey', val);
      }
    }.bind(this));

    return this._super.apply(this, arguments);
  },

  actions: {
    // reindex: function () {
    //   // controller.send('notify', 'info', 'Reindex signal sent.', { icon: 'ok-sign' });
    //   // controller.send('notify', 'success', 'Site reindexed!');
    //   this.transitionTo('reindex');
    // }
  }
});
