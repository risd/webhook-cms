/*globals CustomEvent*/
import Resolver from 'ember/resolver';

var App = Ember.Application.extend({
  LOG_ACTIVE_GENERATION   : true,
  LOG_MODULE_RESOLVER     : true,
  LOG_TRANSITIONS         : true,
  LOG_TRANSITIONS_INTERNAL: true,
  LOG_VIEW_LOOKUPS        : true,
  modulePrefix            : 'appkit', // TODO: loaded via config
  Resolver                : Resolver['default'],
  init: function () {
    window.ENV.firebaseRoot = new Firebase("https://" + window.ENV.dbName + ".firebaseio.com/");
    this._super.apply(this, arguments);
  }
});

Ember.Application.initializer({
  name: "BuildEnvironmentDetector",
  initialize: function (container, application) {
    application.deferReadiness();

    var self     = this,
        buildEnv = Ember.Object.create();

    application.register('build-environment:environment:current', buildEnv, { instantiate: false, singleton: true });
    Ember.A(['model', 'controller', 'view', 'route', 'helper']).forEach(function (component) {
      application.inject(component, 'buildEnvironment', 'build-environment:environment:current');
    });


    var isLocal     = false;
    var localSocket = null;
    var keepReload  = Ember.$('meta[name="keepReload"]').attr('content');

    var req = new XMLHttpRequest();
    req.open('GET', document.location, false);
    req.send(null);
    var headers = req.getAllResponseHeaders().toLowerCase();

    if (headers.indexOf('x-webhook-local') !== -1)
    {
      isLocal = true;
      localSocket = Ember.Object.create({
        socket        : new window.WebSocket('ws://' + document.location.hostname + ':6557'),
        doneCallback  : null,
        connected     : false,
        lostConnection: false,
        message       : '',
      });

      localSocket.socket.onmessage = function (event) {
        if (event.data === 'done') {
          if (localSocket.get('doneCallback')) {
            localSocket.get('doneCallback')();
          }
          localSocket.set('doneCallback', null); //Reset so done doesn't get called twice
        } else if (event.data.indexOf('done:') === 0) {
          var data = JSON.parse(event.data.replace('done:', ''));
          if (localSocket.get('doneCallback')) {
            localSocket.get('doneCallback')(data);
          }
          localSocket.set('doneCallback', null); //Reset so done doesn't get called twice
        } else if (event.data.indexOf('message:') === 0) {
          var message = JSON.parse(event.data.replce('message:', ''));
          localSocket.set('message', message);
        }
      };

      localSocket.socket.onopen = function () {
        localSocket.set('connected', true);
      };

      if (!$('meta[name=suppressAlert]').attr('content')) {
        localSocket.socket.onclose = function () {
          localSocket.set('connected', false);
          localSocket.set('lostConnection', true);
        };
      }

      // Shut down LiveReload
      if (window.LiveReload && !keepReload) {
        var shutDown = new CustomEvent('LiveReloadShutDown');
        document.addEventListener("LiveReloadConnect", function () {
          document.dispatchEvent(shutDown);
        }, false);
      }
    }

    var siteName = Ember.$('meta[name="siteName"]').attr('content');
    buildEnv.set('local', isLocal);
    buildEnv.set('localSocket', localSocket);
    buildEnv.set('siteName', siteName);
    buildEnv.set('siteUrl', 'http://' + siteName + '.webhook.com/');

    window.ENV.siteDNS = siteName + '.webhook.org';
    window.ENV.firebaseRoot.child('/management/sites/' + siteName + '/dns').on('value', function (snap) {
      if (snap.val()) {
        window.ENV.siteDNS = snap.val();
      }
    });

    application.set('buildEnvironment', buildEnv);

    Ember.run(application, application.advanceReadiness);
  }
});

Ember.Application.initializer({
  name: "FirebaseSimpleLogin",
  initialize: function (container, application) {

    application.deferReadiness();

    var self     = this,
        siteName = Ember.$('meta[name="siteName"]').attr('content'),
        session  = Ember.Object.create();

    // Add `session` to all the things
    application.register('firebase-simple-login:session:current', session, { instantiate: false, singleton: true });
    Ember.A(['model', 'controller', 'view', 'route']).forEach(function (component) {
      application.inject(component, 'session', 'firebase-simple-login:session:current');
    });

    var managementSiteRef = window.ENV.firebaseRoot.child('management/sites/' + siteName);

    var firebaseAuth = new FirebaseSimpleLogin(window.ENV.firebaseRoot, function (error, user) {

      var initializeUser = function (snapshot) {
        var bucket = snapshot.val();

        window.ENV.firebase = window.ENV.firebaseRoot.child('buckets/' + siteName + '/' + bucket + '/dev');

        // user authenticated with Firebase
        session.set('user', user);
        session.set('error', null);
        session.set('site', {
          name : siteName,
          token: bucket
        });

        session.set('isOwner', false);
        managementSiteRef.on('value', function (snapshot) {
          var siteData = snapshot.val();
          var escapedEmail = user.email.replace(/\./g, ',1');

          if (siteData.owners[escapedEmail]) {
            session.set('isOwner', true);
          } else if (siteData.users[escapedEmail]) {
            session.set('isOwner', false);
          }
        });

        Ember.Logger.info('Logged in as ' + user.email);

        Ember.run(application, application.advanceReadiness);
      };

      if (error) {
        // an error occurred while attempting login
        session.set('error', error);
        Ember.run(application, application.advanceReadiness);
      } else if (user) {

        managementSiteRef.child('key').once('value', initializeUser, function (error) {

          if (error.code === 'PERMISSION_DENIED') {
            var escapedEmail = user.email.replace(/\./g, ',1');
            // Try to add to user list, if this is allowed they were a potential user
            managementSiteRef.child('users').child(escapedEmail).set(user.email, function (error) {
              if (error) {
                session.get('auth').logout();
                session.set('error', error);
                Ember.run(application, application.advanceReadiness);
              } else {
                // Try to delete self from potential user list
                managementSiteRef.child('potential_users').child(escapedEmail).remove(function (error) {
                  if (error) {
                    session.get('auth').logout();
                    session.set('error', error);
                    Ember.run(application, application.advanceReadiness);
                  } else {
                    // Redo original authorization call
                    managementSiteRef.child('key').once('value', initializeUser, function (error) {
                      if (error) {
                        session.get('auth').logout();
                        session.set('error', error);
                      }
                      Ember.run(application, application.advanceReadiness);
                    });
                  }
                });
              }
            });
            // User may be a potential, try and elevate to user
          } else {
            session.get('auth').logout();
            session.set('error', error);
            Ember.run(application, application.advanceReadiness);
          }

        });

      } else {
        // user is logged out
        session.set('user', null);
        session.set('site', null);
        Ember.run(application, application.advanceReadiness);
      }
    });

    session.set('auth', firebaseAuth);

    window.ENV.sendBuildSignal = function (publish_date) {
      var user = session.get('user.email');

      if (application.get('buildEnvironment').local === false) {

        var data = {
          'userid': user,
          'sitename': siteName
        };

        if (publish_date) {
          data.build_time = publish_date;
        }

        window.ENV.firebase.root().child('management/commands/build/' + siteName).set(data, function () {});
      } else {
        window.ENV.sendGruntCommand('build');
      }
    };

    window.ENV.sendGruntCommand = function (command, callback) {
      var localSocket = application.get('buildEnvironment').localSocket;
      if (localSocket && localSocket.connected) {
        localSocket.socket.send(command);
        if (callback) {
          localSocket.doneCallback = callback;
        }
      }
    };
  }
});

// Before any route, kick user to login if they aren't logged in
Ember.Route.reopen({
  beforeModel: function (transition) {
    var openRoutes = ['login', 'password-reset', 'create-user', 'confirm-email', 'resend-email'];
    if (Ember.$.inArray(transition.targetName, openRoutes) === -1 && !this.get('session.user')) {
      this.set('session.transition', transition);
      transition.abort();
      this.transitionTo('login');
    } else { // Only executed if your logged in
      var ownerRoutes = ['wh.settings.team', 'wh.settings.general', 'wh.settings.billing', 'wh.settings.domain', 'wh.settings.data'];
      if (Ember.$.inArray(transition.targetName, ownerRoutes) !== -1 && !this.get('session.isOwner')) {
        this.set('session.transition', transition);
        transition.abort();
        this.transitionTo('wh.index');
      }
    }

  }
});

Ember.TextField.reopen({
  attributeBindings: [ 'required' ]
});

// Ian doesn't like pluralizing, singularizing
Ember.Inflector.inflector.pluralize = function (string ) { return string; };
Ember.Inflector.inflector.singularize = function (string ) { return string; };

export default App;
