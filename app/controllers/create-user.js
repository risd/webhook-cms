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

      var verifyUser = function(userEmail, key, callback) {
        var root = window.ENV.firebaseRoot.ref('management/users/' + userEmail.toLowerCase().replace(/\./g, ',1') + '/verification');

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

      var userEmail = this.get('email');
      var userPassword = this.get('password');
      var sessionAuth = this.get('session.auth');

      sessionAuth.createUserWithEmailAndPassword(userEmail, userPassword )
        .then( createdUser.bind( this ) )
        .catch( errorCreatingUser.bind( this ) )

      function createdUser ( user ) {
        this.set('success', 'Signed up!');

        // Mark the user as existing, queue up confirmation email
        window.ENV.firebaseRoot.ref('management/users/' + userEmail.toLowerCase().replace(/\./g, ',1') + '/exists').set(true, function(err) {
          if(!window.ENV.selfHosted) {

            verifyUser(userEmail, this.get('verification_key'), function(err) {
              this.set('isSending', false);
              if(err) {
                this.set('error', err);
                return;
              }

            }.bind(this));

          } else {
            this.set('isSending', false);
          }
        }.bind(this));
      }

      function errorCreatingUser ( error ) {
        this.set('error', error);
      }
    }
  }
});
