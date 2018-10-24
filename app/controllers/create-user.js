export default Ember.ObjectController.extend({
  email    : null,
  password : "",
  password2: "",
  isSending: false,
  isLoading: false,
  success  : false,
  error    : null,
  verification_key: null,

  userChanged: function () {
    Ember.Logger.log('CreateUser::userChanged');
    this.set('isLoading', false);
    if (this.get('session.transition')) {
      this.get('session.transition').retry();
    } else {
      this.transitionToRoute('index');
    }
  }.observes('session.user'),

  passwordMatches: function () {
    return this.get('password') === this.get('password2');
  }.property('password', 'password2'),

  actions: {
    createUser: function () {

      this.setProperties({
        success: false,
        error: null
      });

      if (!this.get('passwordMatches') || !this.get('password')) {
        return;
      }

      if (!this.get('verification_key') && !window.ENV.selfHosted) {
        this.set('error', { code: 'IMPOSSIBLE', message: 'No verification key specified, please go through the invite process' });
        return;
      }

      this.set('isSending', true);

      var verifyUser = function(user, key, callback) {
        var root = window.ENV.firebaseRoot.ref('management/users/' + user.email.toLowerCase().replace(/\./g, ',1') + '/verification');

        root.child('verified').once('value', function(snapshot) {
          var val = snapshot.val();

          if(val) {
            callback(null);
          } else {
            root.set({ verification_key_match: key, verified: true }, function(err) {
              if(err) {
                callback(err);
              } else {
                callback(null);
              }
            });
          }

        });
      };

      this.get('session.auth').createUser(this.get('email'), this.get('password'), function (error, user) {
        if (!error) {
          this.set('success', 'Signed up!');
        } else {
          this.set('error', error);
          return;
        }

        // Mark the user as existing, queue up confirmation email
        var token = user.token;
        var fireRoot = window.ENV.firebaseRoot;
        fireRoot.authWithCustomToken(token, function() {

          fireRoot.child('management/users/' + user.email.toLowerCase().replace(/\./g, ',1') + '/exists').set(true, function(err) {
            if(!window.ENV.selfHosted) {

              verifyUser(user, this.get('verification_key'), function(err) {
                fireRoot.unauth();
                this.set('isSending', false);
                if(err) {
                  this.set('error', err);
                  return;
                }

                this.get('session.auth').login('password', {
                  email     : this.get('email'),
                  password  : this.get('password'),
                  rememberMe: true
                });

              }.bind(this));

            } else {
              fireRoot.unauth();
              this.set('isSending', false);

              this.get('session.auth').login('password', {
                email     : this.get('email'),
                password  : this.get('password'),
                rememberMe: true
              });
            }
          }.bind(this));
        }.bind(this));

      }.bind(this));
    }
  }
});
