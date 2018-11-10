export default Ember.ObjectController.extend({
  email: null,
  isSending: false,
  success: false,
  error: null,

  actions: {
    resetPassword: function () {

      if (Ember.isEmpty(this.get('email'))) {
        return;
      }

      this.set('isSending', true);
      this.set('success', false);
      this.set('error', null);

      this.get('session.auth').sendPasswordResetEmail( this.get( 'email' ) )
        .then( function () {
          this.set('success', true);
          this.set('isSending', false);
        }.bind( this ) )
        .catch( function ( error ) {
          this.set('success', false);
          this.set('isSending', false);
          this.set('error', error);
        }.bind( this ) );
    }
  }
});
