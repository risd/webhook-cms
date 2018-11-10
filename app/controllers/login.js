export default Ember.Controller.extend({
  email    : null,
  password : null,
  isLoading: false,

  userChanged: function () {
    Ember.Logger.log('LoginController::userChanged');
    this.set('isLoading', false);
    if (this.get('session.transition')) {
      this.get('session.transition').retry();
    } else {
      this.transitionToRoute('index');
    }
  }.observes('session.user'),

  errorChanged: function () {
    this.set('isLoading', false);
  }.observes('session.error'),

  supportedLanguages: function () {
    var languages = Ember.A([]);
    Ember.$.each(Ember.ENV.I18N_CODE_MAP, function (code, language) {
      languages.push({ code: code, language: language });
    });
    return languages;
  }.property(),

  actions: {
    loginUser: function () {
      if (this.get('isLoading')) {
        return;
      }

      if (this.get('email') === '') {
        this.get('session').set('error', {
          code: 'Invalid Login',
          message: 'Please enter an email address.'
        });
        return;
      }

      if (this.get('password') === '') {
        this.get('session').set('error', {
          code: 'Invalid Login',
          message: 'Please enter a password.'
        });
        return;
      }

      this.get('session').set('error', null);
      this.set('isLoading', true);

      this.get('session.auth').signInWithEmailAndPassword(this.get('email'), this.get('password'));
    }
  }
});
