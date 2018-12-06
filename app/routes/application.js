/*global firebase*/

import Group from 'appkit/models/group';
import User from 'appkit/models/user';

function uniqueId() {
  return Date.now() + 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

export default Ember.Route.extend({
  notifications: [],

  getBuildEnvironment: function () {

    var route = this;

    if (Ember.isEmpty(route.get('buildEnvironment.isInitialized'))) {
      Ember.Logger.log('ApplicationRoute::getBuildEnvironment');
    } else {
      Ember.Logger.log('ApplicationRoute::getBuildEnvironment::skip');
      return Ember.RSVP.Promise.resolve();
    }

    var buildEnv = route.get('buildEnvironment');

    buildEnv.set('isInitialized', true);

    var siteName = Ember.$('meta[name="siteName"]').attr('content');

    buildEnv.set('siteDisplayName', window.ENV.selfHosted ? siteName.replace('/,1/g', '.') : siteName);
    buildEnv.set('selfHosted', window.ENV.selfHosted);
    buildEnv.set('forceDomain', window.ENV.selfHosted ? (window.ENV.forceDomain || false) : false);

    if (!window.ENV.selfHosted) {
      window.ENV.siteDNS = siteName + '.webhook.org';
      window.trackingInfo.siteDNS = window.ENV.siteDNS;
    }

    window.ENV.firebaseRoot.ref('/management/sites/' + siteName + '/dns').on('value', function (snap) {
      if (snap.val()) {
        window.ENV.siteDNS = snap.val();
        window.trackingInfo.siteDNS = window.ENV.siteDNS;
      }
    });

    if (window.ENV.uploadUrl.indexOf('http://') !== 0) {
      if (window.ENV.uploadUrl.indexOf('https://') !== 0 ) {
        window.ENV.uploadUrl = 'http://' + window.ENV.uploadUrl; 
      }
    }

    if (window.ENV.uploadUrl.substr(-1) !== '/') {
      window.ENV.uploadUrl = window.ENV.uploadUrl + '/';
    }

    // Check if we're in the dev or live environment
    return new Ember.RSVP.Promise(function (resolve, reject) {
      var req = new XMLHttpRequest();

      req.onreadystatechange = function () {
        if (this.readyState === this.DONE) {
          if (this.getAllResponseHeaders().toLowerCase().indexOf('x-webhook-local') === -1) {
            reject();
          } else {
            resolve();
          }
        }
      };

      req.open('GET', document.location);
      req.send(null);

    }).then(function () {

      Ember.Logger.log('ApplicationRoute::getBuildEnvironment::dev');

      return new Ember.RSVP.Promise(function (resolve, reject) {

        buildEnv.set('local', true);

        var localSocket = Ember.Object.create();

        Ember.Logger.log('ApplicationRoute::getBuildEnvironment::dev::socketSetup');
        var socket = new window.WebSocket('ws://' + document.location.hostname + ':6557');

        socket.onmessage = function (event) {
          if (event.data === 'done') {
            if (localSocket.get('doneCallback')) {
              localSocket.get('doneCallback')();
              localSocket.set('doneCallback', null);
            }
          } else if (event.data.indexOf('done:') === 0) {
            if (localSocket.get('doneCallback')) {
              localSocket.get('doneCallback')(JSON.parse(event.data.replace('done:', '')));
              localSocket.set('doneCallback', null);
            }
          } else if (event.data.indexOf('message:') === 0) {
            var message = JSON.parse(event.data.replace('message:', ''));
            localSocket.set('message', message);
          }
        };

        socket.onopen = function () {
          resolve();
        };

        socket.onerror = function () {
          resolve();
        };

        Ember.Logger.log('ApplicationRoute::getBuildEnvironment::dev::alertCheck');
        if (!Ember.$('meta[name=suppressAlert]').attr('content')) {
          socket.onclose = function () {
            localSocket.set('lostConnection', true);
          };
        }

        Ember.Logger.log('ApplicationRoute::getBuildEnvironment::dev::setEnv');
        localSocket.set('socket', socket);

        buildEnv.set('localSocket', localSocket);
      });

    }, function () {
      // No setup required for live environment
      Ember.Logger.log('ApplicationRoute::getBuildEnvironment::live');
    });
  },

  getMessageSuport: function () {

    var route = this;

    if (Ember.isEmpty(route.get('session.supportedMessages'))) {
      Ember.Logger.log('ApplicationRoute::getMessageSupport');
    } else {
      Ember.Logger.log('ApplicationRoute::getMessageSupport::skip');
      return Ember.RSVP.Promise.resolve();
    }

    route.set('session.supportedMessages', Ember.Object.create());

    return new Ember.RSVP.Promise(function (resolve, reject) {

      var localSocket = route.get('buildEnvironment.localSocket');

      if (!localSocket || localSocket.get('socket').readyState !== window.WebSocket.OPEN) {

        Ember.$.ajax({
          dataType: 'jsonp',
          jsonpCallback: 'supportedJSONPCallback',
          url: '/.wh/_supported/',
          success: resolve,
          error: reject
        });

      } else {

        route.gruntCommand('supported_messages', resolve);

      }

    }).then(function (messages) {
      messages.forEach(function (message) {
        route.get('session.supportedMessages').set(message, true);
      });
      Ember.Logger.info('Server Messages Supported:', messages.join(', '));
    }, function (error) {
      Ember.Logger.warn('Failed to retrieve supported grunt messages.');
    });
  },

  // Confirm that user has completed validation steps
  validateUser: function () {

    Ember.Logger.log('ApplicationRoute::validateUser');

    var session = this.get('session');
    var siteName = session.get('site.name');

    window.trackingInfo.siteName = siteName;

    var managementSiteRef = window.ENV.firebaseRoot.ref('management/sites/' + siteName);

    return new Ember.RSVP.Promise(function (resolve, reject) {

      var user = firebase.auth().currentUser;

      var getToken = function (snapshot) {
        var token = snapshot.val();
        session.set('site.token', token);

        Ember.Logger.log('ApplicationRoute::get-token');

        window.ENV.firebase = window.ENV.firebaseRoot.ref('buckets/' + siteName + '/' + token + '/dev');

        Ember.Logger.log('window.ENV.firebase');
        Ember.Logger.log(window.ENV.firebase);

        // if you just logged in, we have to set the firebase property
        DS.FirebaseAdapter.reopen({
          firebase: window.ENV.firebase
        });

        Ember.Logger.log('ApplicationRoute::validateUser::✓');
        resolve(user);
      };

      managementSiteRef.child('key').once( 'value' )
        .then( getToken )
        .catch( function (error) {
          if (error.code === 'PERMISSION_DENIED') {
            var escapedEmail = user.email.toLowerCase().replace(/\./g, ',1');
            // Try to add to user list, if this is allowed they were a potential user
            managementSiteRef.child('users').child(escapedEmail).set(user.email.toLowerCase(), function (error) {
              if (error) {
                reject(error);
                return;
              }
              managementSiteRef.root.child('management/users').child(escapedEmail).child('sites/user').child(siteName).set(true, function (error) {
                if (error) {
                  reject(error);
                  return;
                }
                // Try to delete self from potential user list
                managementSiteRef.child('potential_users').child(escapedEmail).remove(function (error) {
                  if (error) {
                    reject(error);
                    return;
                  }
                  // Redo original authorization call
                  managementSiteRef.child('key').once('value', getToken, reject);
                });
              });
            });
          } else {
            reject(error);
          }
      });

    });

  },

  initializeUser: function (user) {

    Ember.Logger.log('ApplicationRoute::initializeUser');
    Ember.Logger.log(user);

    var route = this;
    var session = route.get('session');
    var siteName = session.get('site.name');

    var managementSiteRef = window.ENV.firebaseRoot.ref('management/sites/' + siteName);

    if (!route.get('buildEnvironment.local')) {
      this.setupMessageListener();
    }

    Ember.Logger.info('Logged in as ' + user.email);

    var escapedEmail = user.email.toLowerCase().replace(/\./g, ',1');

    var ownerCheck = new Ember.RSVP.Promise(function (resolve, reject) {
      Ember.Logger.log('ApplicationRoute::initializeUser::ownerCheck');
      session.set('isOwner', false);
      managementSiteRef.once('value', function (snapshot) {
        var siteData = snapshot.val();

        if (siteData.owners[escapedEmail]) {
          Ember.Logger.info('Logged in user is a site owner.');
          session.set('isOwner', true);
        } else if (siteData.users[escapedEmail]) {
          Ember.Logger.info('Logged in user is a site user.');
        } else {
          Ember.Logger.error('Logged in user is neither a site owner or site user??');
        }

        Ember.run(null, resolve);

      });
    });

    // Default billing values
    var billing = Ember.Object.create({
      active: true,
      status: 'paid',
      url: 'http://billing.webhook.com/site/' + siteName + '/',
    });
    billing.reopen({
      isPaid: function () {
        return this.get('status') === 'paid';
      }.property('status'),
      isTrial: function () {
        return this.get('status') === 'trialing';
      }.property('status')
    });
    session.set('billing', billing);

    // Grab actual billing values
    var billingRef = window.ENV.firebaseRoot.ref('billing/sites/' + siteName);

    var activeCheck = new Ember.RSVP.Promise(function (resolve, reject) {
      Ember.Logger.log('ApplicationRoute::initializeUser::activeCheck');
      billingRef.child('active').once('value', function (snapshot) {
        session.set('billing.active', snapshot.val());
        Ember.run(null, resolve);
      });
    });

    var statusCheck = new Ember.RSVP.Promise(function (resolve, reject) {
      Ember.Logger.log('ApplicationRoute::initializeUser::statusCheck');
      billingRef.child('status').once('value', function (snapshot) {
        session.set('billing.status', snapshot.val());
        Ember.run(null, resolve);
      });
    });

    var endTrialCheck = new Ember.RSVP.Promise(function (resolve, reject) {
      Ember.Logger.log('ApplicationRoute::initializeUser::endTrialCheck');
      billingRef.child('endTrial').once('value', function (snapshot) {
        var endTrial = snapshot.val();
        if (endTrial) {
          var endTrialDays = Math.ceil(moment(snapshot.val()).diff(moment(), 'days', true));
          session.set('billing.endTrial', endTrial);
          session.set('billing.endTrialDays', endTrialDays);
          session.set('billing.endTrialIsLastDay', endTrialDays === 1);
        }
        Ember.run(null, resolve);
      });
    });

    return Ember.RSVP.Promise.all([ownerCheck, activeCheck, statusCheck, endTrialCheck]).then(function () {
      Ember.Logger.log('ApplicationRoute::initializeUser::✓');
      route.set('session.user', { email: user.email, uid: user.uid });
    });

  },

  getSession: function () {

    var route = this;
    var session = route.get('session');

    if (Ember.isEmpty(session.get('auth'))) {
      Ember.Logger.log('ApplicationRoute::getSession');
    } else {
      Ember.Logger.log('ApplicationRoute::getSession::skip');
      return Ember.RSVP.Promise.resolve();
    }

    var siteName = session.get('site.name');

    var managementSiteRef = window.ENV.firebaseRoot.ref('management/sites/' + siteName);

    return new Ember.RSVP.Promise(function (resolve, reject) {
      Ember.Logger.log('ApplicationRoute::getSession::promise');

      var firebaseAuth = {
        signInWithEmailAndPassword: firebaseEmailPasswordAuth,
        currentUser: currentUser,
        signOut: signOut,
        reAuthWithPassword: reAuthWithPassword,
        createUserWithEmailAndPassword: createUserWithEmailAndPassword,
        sendPasswordResetEmail: sendPasswordResetEmail,
      };
      session.set('auth', firebaseAuth);

      // triggers as Firebase first initializes the auth state.
      firebase.auth().onAuthStateChanged( initializedUser )

      function initializedUser ( user ) {
        firebase.auth().onAuthStateChanged( function noop () {} )
        if ( user ) return successfullySignedIn( user )
        else notSignedIn( user )
      }

      function successfullySignedIn ( user ) {
        if ( bailIfDestroyed() ) return;
        Ember.Logger.log('LoginController::signInWithEmailAndPassword::user');
        if(window.Raygun) {
          window.Raygun.setUser(user.email, false, user.email);
          window.trackingInfo.user = user.email;
        }
        window.trackingInfo.loggedIn = true;
        // Logged in
        route.validateUser()
          .then(route.initializeUser.bind(route), notSignedIn)
          .then(route.getTeam.bind(route), notSignedIn)
          .then(resolve, notSignedIn);
      }

      function notSignedIn ( error ) {
        if ( bailIfDestroyed() ) return;
        window.trackingInfo.loggedIn = false;
        // user is logged out
        session.set('user', null);
        session.set('site.token', null);
        if ( error && error.code && error.message ) {
          session.set('error', error);
          return reject( error );
        }
        else if ( error ) {
          var errorDuringAuth = {
            code: 'Authentication Error',
            message: 'Could not authenticate user.',
          };
          session.set( 'error', errorDuringAuth );
          return reject( errorDuringAuth );
        }
        else {
          return resolve();
        }
      }

      function bailIfDestroyed () {
        if (route.get('isDestroyed')) {
          Ember.Logger.log('ApplicationRoute::getSession::destroyed');
          return true;
        }
      }

      // Closure that handles firebase authe with email & password
      function firebaseEmailPasswordAuth ( email, password ) {

        if ( bailIfDestroyed() ) return;
        var user = firebaseAuth.currentUser()
        if ( user ) return successfullySignedIn( user );

        firebase.auth().signInWithEmailAndPassword( email, password )
          .then( successfullySignedIn )
          .catch( notSignedIn );
      }

      function currentUser () { return firebase.auth().currentUser }
      function signOut () { return firebase.auth().signOut() }
      function createUserWithEmailAndPassword ( email, password ) {
        return firebase.auth().createUserWithEmailAndPassword( email, password )
      }

      function reAuthWithPassword ( password ) {
        var email = firebaseAuth.currentUser().email;
        return firebase.auth().signInWithEmailAndPassword( email, password )
      }

      function sendPasswordResetEmail ( email ) {
        var redirectTo = encodeURIComponent( [ 'https://', siteName.replace( /,1/g, '.' ), '/cms' ].join('') )
        var continuationUrl = [ 'https://redirect.risd.systems/index.html?to=', redirectTo ].join( '' )
        return firebase.auth().sendPasswordResetEmail( email, { url: continuationUrl } );
      }
    });
  },

  // Need team (users & groups) for permissions
  getTeam: function () {

    Ember.Logger.log('ApplicationRoute::getTeam');

    var siteName = this.get('session.site.name');
    var siteManagementRef = window.ENV.firebaseRoot.ref('management/sites').child(siteName);

    var route = this;

    var users = Ember.A([]);

    var addToUsers = function (addedUser, type) {
      var user = users.findBy('key', addedUser.key);
      if (Ember.isEmpty(user)) {
        user = User.create();
        user.set('key', addedUser.key);
        user.set('email', addedUser.email);
        users.pushObject(user);
      }
      user.set(type, true);
    };

    var addOwners = new Ember.RSVP.Promise(function (resolve, reject) {
      siteManagementRef.child('owners').once('value', function (snapshot) {

        snapshot.forEach(function (snapshot) {
          addToUsers({ key: snapshot.key, email: snapshot.val() }, 'owner');
        });

        snapshot.ref.on('child_added', function (snapshot) {
          addToUsers({ key: snapshot.key, email: snapshot.val() }, 'owner');
        });

        snapshot.ref.on('child_removed', function (snapshot) {
          users.findBy('key', snapshot.key).set('owner', false);
        });

        resolve();
      }, function (error) {
        Ember.Logger.warn(error);
        resolve();
      });
    });

    var addUsers = new Ember.RSVP.Promise(function (resolve, reject) {
      siteManagementRef.child('users').once('value', function (snapshot) {

        snapshot.forEach(function (snapshot) {
          addToUsers({ key: snapshot.key, email: snapshot.val() }, 'user');
        });

        snapshot.ref.on('child_added', function (snapshot) {
          addToUsers({ key: snapshot.key, email: snapshot.val() }, 'user');
        });

        snapshot.ref.on('child_removed', function (snapshot) {
          users.findBy('key', snapshot.key).set('user', false);
        });

        resolve();
      }, function (error) {
        Ember.Logger.warn(error);
        resolve();
      });
    });

    var addPotentialUsers = new Ember.RSVP.Promise(function (resolve, reject) {
      siteManagementRef.child('potential_users').once('value', function (snapshot) {

        snapshot.forEach(function (snapshot) {
          addToUsers({ key: snapshot.key, email: snapshot.val() }, 'potential');
        });

        snapshot.ref.on('child_added', function (snapshot) {
          addToUsers({ key: snapshot.key, email: snapshot.val() }, 'potential');
        });

        snapshot.ref.on('child_removed', function (snapshot) {
          users.findBy('key', snapshot.key).set('potential', false);
        });

        resolve();
      }, function (error) {
        Ember.Logger.warn(error);
        resolve();
      });
    });

    var groups = Ember.A([]);

    var addGroup = function (groupSnapshot) {

      if (groups.findBy('key', groupSnapshot.key)) {
        return;
      }

      var groupData = groupSnapshot.val();

      var group = Group.create({
        name: groupData.name,
        key: groupSnapshot.key,
        permissions: Ember.Object.create({})
      });

      // watch for permission changes

      Ember.$.each(groupData.permissions || {}, function (contentTypeId, permission) {
        group.get('permissions').set(contentTypeId, permission);
      });

      groups.addObject(group);

      var groupPermissionsRef = groupSnapshot.ref.child('permissions');

      groupPermissionsRef.on('child_changed', function (snapshot) {
        group.get('permissions').set(snapshot.key, snapshot.val());
      });

      groupPermissionsRef.on('child_added', function (snapshot) {
        var contentTypeId = snapshot.key;
        var permission = snapshot.val();
        if (group.get('permissions').get(contentTypeId) !== permission) {
          group.get('permissions').set(contentTypeId, permission);
        }
      });

      groupPermissionsRef.on('child_removed', function (snapshot) {
        group.get('permissions').set(snapshot.key, null);
      });

      // watch for user changes

      var groupUsersRef = groupSnapshot.ref.child('users');

      Ember.keys(groupData.users || {}).forEach(function (escapedEmail) {
        var user = users.findBy('key', escapedEmail);
        user.set('group', group);
        group.get('users').addObject(user);

        if (route.get('session.user.email') === user.get('email')) {
          route.set('session.user.permissions', group.get('permissions'));
        }
      });

      groupUsersRef.on('child_added', function (snapshot) {
        var escapedEmail = snapshot.key;

        if (group.get('users').findBy('key', escapedEmail)) {
          return;
        }

        var user = users.findBy('key', escapedEmail);
        user.set('group', group);
        group.get('users').addObject(user);

        if (route.get('session.user.email') === user.get('email')) {
          route.set('session.user.permissions', group.get('permissions'));
        }

      });

      groupUsersRef.on('child_removed', function (snapshot) {
        var escapedEmail = snapshot.key;

        if (!group.get('users').findBy('key', escapedEmail)) {
          return;
        }

        var user = users.findBy('key', escapedEmail);
        user.set('group', null);
        group.get('users').removeObject(user);
        siteManagementRef.child('permissions').child(escapedEmail).remove();

        if (route.get('session.user.email') === user.get('email')) {
          route.set('session.user.permissions', null);
        }

      });

    };

    var addGroups = new Ember.RSVP.Promise(function (resolve, reject) {
      siteManagementRef.child('groups').once('value', function (snapshot) {

        snapshot.forEach(addGroup);

        snapshot.ref.on('child_added', addGroup);
        snapshot.ref.on('child_removed', function (snapshot) {
          var groupKey = snapshot.key;
          var group = groups.findBy('key', groupKey);
          groups.removeObject(group);
        });

        resolve();
      }, function (error) {
        Ember.Logger.warn(error);
        route.set('team.isGroupsDisabled', true);
        resolve();
      });
    });

    return Ember.RSVP.all([addOwners, addUsers, addPotentialUsers]).then(addGroups).then(function () {
      route.set('team.users', users);
      route.set('team.groups', groups);
      Ember.Logger.log('ApplicationRoute::getTeam::✓');
    });

  },

  beforeModel: function () {
    Ember.Logger.log('ApplicationRoute::beforeModel');

    var route = this;

    return this.getBuildEnvironment().then(function () {
      return Ember.RSVP.Promise.all([
        route.getSession(),
        route.getMessageSuport(),
        // control types are fixtures, throw them in the store
        route.store.find('control-type')
      ]);

    });
  },

  setupController: function (controller) {
    controller.set('notifications', this.get('notifications'));
    this._super.apply(this, arguments);
  },

  gruntCommand: function (command, callback) {
    Ember.Logger.log('%cgruntCommand -> ' + command, 'color: purple; font-weight: bold');

    var localSocket = this.get('buildEnvironment.localSocket');
    if (localSocket && localSocket.get('socket').readyState === window.WebSocket.OPEN) {
      localSocket.get('socket').send(command);
      if (callback) {
        localSocket.set('doneCallback', callback);
      }
    }
  },

  messageListener: null,
  setupMessageListener: function () {

    var route = this;
    var listener = this.get('messageListener');
    var siteName = this.get('session.site.name');
    var buildEnv = this.get('buildEnvironment');

    var ref = window.ENV.firebase.root.child('management/sites/' + siteName + '/messages');
    if (listener) {
      ref.off('child_added', listener);
      listener = null;
    }

    var initialIds = {};
    ref.once('value', function(totalData) {
      var val = totalData.val();

      for(var key in val) {
        initialIds[key] = true;
      }

      listener = ref.on('child_added', function(snap) {
        var now = Date.now();
        var message = snap.val();
        var id = snap.key;

        if(!initialIds[id]) {
          if(message.code === 'BUILT') {
            if(message.status === 0) {
              route.send('notify', 'success', 'Site build complete', { icon: 'refresh' });
            } else {
              route.send('notify', 'danger', 'Site build failed', { icon: 'remove' });
            }
            buildEnv.set('building', false);
          }
          else if ( message.code === 'SITE_INDEX' ) {
            if ( message.status === 0 ) {
              route.send('notify', 'success', 'Site reindex complete', { icon: 'refresh' });
            } else {
              route.send('notify', 'danger', 'Site reindex failed', { icon: 'remove' });
            }
          }
        }
      });

      route.set('messageListener', listener);

    });
  },

  actions: {
    logoutUser: function () {

      window.ENV.firebase.child('presence/online').child(this.get('session.user.uid')).remove();

      this.get('session.auth').signOut();
      this.set('session.user', null);
      this.transitionTo('login');
    },

    notify: function (type, message, options) {

      options = options || {};

      var notifications = this.get('notifications'),
          notification = Ember.Object.create({
            className: 'wy-tray-item' + (type ? '-' + type : ''),
            message: message
          });

      if (options.icon) {
        notification.set('iconClass', 'icon icon-' + options.icon);
      }

      if (options.className) {
        notification.set('extraClassName', options.className);
      }

      notifications.pushObject(notification);

      Ember.run.later(this, function () {
        notification.set('state', 'on');
      }, 10);

      Ember.run.later(this, function () {
        notification.set('state', null);
      }, 4500);

      Ember.run.later(this, function () {
        notifications.removeObject(notification);
      }, 5000);

    },

    chooseLanguage: function (language) {
      Ember.Logger.log('Changing language to %@'.fmt(language));
      window.localStorage.setItem('webhook-cms-language', language);

      Ember.Logger.log('Resetting app.');
      window.App.reset();
    },

    /**
     * Publishes site messages that will appear on the `build history` log of the CMS index
     * 
     * @param  {object} options
     * @param  {string} options.code     The type of message that is coming through
     * @param  {string} options.message  The message to post on the event log
     */
    eventLog: function ( options ) {
      var siteName = this.get( 'session.site.name' );
      var timestamp = Date.now();

      var logEntry = Object.assign( { timestamp: timestamp }, options );

      var logRef = window.ENV.firebase.root.child( '/management/sites' ).child( siteName ).child( 'messages' );

      // push log entry
      logRef.push( logEntry, function onComplete () {
        pruneList( 50 );
      } );

      // checks the logRef length & keeps it below the maxLength
      function pruneList ( maxLength ) {
        logRef.once( 'value', function ( logSnapshot ) {
          var logLength;
          try {
            logLength = Object.keys( logSnapshot.val() ).length;
          } catch( error ) {
            logLength = 0;
          }

          if ( logLength > maxLength ) {
            logRef.limitToFirst( 1 ).once( 'child_added', function ( snap ) {
              snap.ref.remove();
            } );
          }
        } );
      }
    },

    buildSignal: function (publishDate, options) {
      if ( !options ) options = {};

      Ember.Logger.info('Sending build signal:%@'.fmt(publishDate || 'No publish date.'));

      var route = this;

      var user = route.get('session.user.email');

      if (!route.get('buildEnvironment.local')) {

        var data = {
          userid: user,
          sitename: route.get('session.site.name'),
          id: uniqueId()
        };

        if (publishDate) {
          data.build_time = publishDate;
        }

        if (options.contentType) data.contentType = options.contentType;
        if (options.itemKey) data.itemKey = options.itemKey;

        window.ENV.firebase.root.child('management/commands/previewBuild/' + route.get('session.site.name')).set(data);
        window.ENV.firebase.root.child('management/commands/build/' + route.get('session.site.name')).set(data);
        route.set('buildEnvironment.building', true);

      } else {

        route.send('gruntCommand', 'build', function () {
          route.send('notify', 'success', 'Local build complete', { icon: 'refresh' });
        });

      }
    },

    gruntCommand: function (command, callback) {
      this.gruntCommand.apply(this, arguments);
    },

    importWordpressFile: function (file) {
      if (!Ember.isEmpty(file)) {
        this.set('controller.wordpressXML', file);
        this.transitionTo('wordpress');
      }
    },

    importData: function (file) {

      var route = this;
      route.set('importDataError', null);

      var reader = new window.FileReader();

      reader.onload = function (e) {
        var rawData;
        try {
          rawData = JSON.parse(reader.result);
        } catch (error) {
          Ember.Logger.error(error);
          route.set('importDataError', error);
        }
        route.set('controller.importData', rawData);
        route.transitionTo('wh.settings.data');
      };

      reader.readAsText(file);

    }
  }
});
