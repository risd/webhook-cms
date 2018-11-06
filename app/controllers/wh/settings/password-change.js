export default Ember.ObjectController.extend({

  oldPassword : "",
  newPassword : "",
  newPassword2: "",

  isLoading: false,
  success  : false,
  errors   : Ember.A([]),

  isValid: false,

  supportedLanguages: function () {
    var languages = Ember.A([]);
    Ember.$.each(Ember.ENV.I18N_CODE_MAP, function (code, language) {
      languages.push({ code: code, language: language });
    });
    return languages;
  }.property(),

  reset: function () {
    this.setProperties({
      isValid     : false,
      isLoading   : false,
      success     : false,
      errors      : Ember.A([]),
      oldPassword : "",
      newPassword : "",
      newPassword2: "",
    });
  },

  passwordMatches: function () {
    return this.get('newPassword') === this.get('newPassword2');
  }.property('newPassword', 'newPassword2'),

  validateInput: function () {

    this.set('isValid', true);
    this.get('errors').clear();

    if (!this.get('passwordMatches')) {
      this.set('isValid', false);
      this.get('errors').pushObject('New passwords need to match.');
    }

    if (!this.get('oldPassword')) {
      this.set('isValid', false);
      this.get('errors').pushObject('Old password is missing.');
    }

    if (!this.get('newPassword')) {
      this.set('isValid', false);
      this.get('errors').pushObject('New password is missing.');
    }

  },

  actions: {
    changePassword: function () {

      this.set('success', false);

      this.validateInput();

      if (!this.get('isValid')) {
        return;
      }

      this.set('isLoading', true);

      var email = this.get('session.user.email'),
          oldPassword = this.get('oldPassword'),
          newPassword = this.get('newPassword');

      var sessionAuth = this.get('session.auth')

      var self = this;
      // Ensure existing password is correct
      sessionAuth.reAuthWithPassword( oldPassword )
        .then( function updatePassword ( user ) {
          return sessionAuth.currentUser().updatePassword( newPassword )
        } )
        .then( function successSet () {
          self.set( 'isLoading', false );
          self.set('success', {
            message: 'Password successfully changed'
          });
          self.set('oldPassword', '');
          self.set('newPassword', '');
          self.set('newPassword2', '');
        } )
        .catch( function errorSet ( error ) {
          self.set( 'isLoading', false );
          self.set( 'errors', Ember.A( [ error ] ) );
        } )
    }
  }
});
